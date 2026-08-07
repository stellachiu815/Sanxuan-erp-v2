import { prisma } from "@/lib/prisma";
import { archiveMember, archiveHousehold, previewHouseholdArchive } from "@/lib/householdManagement";
import { purgeArchivedHouseholdUsRecords } from "@/lib/purgeArchivedHouseholdUsRecords";

/**
 * V37 依家戶編號「封存家戶（可連同成員）」——瀏覽器可觸發，軟刪除、可從回收區還原。
 *
 * 用途：清掉之前混亂匯入時自動生出來的空殼／重複家戶（如 F00884、F00885）。
 * 系統規定有「在戶成員」不能直接封存，本工具在 commit 時先把該戶成員一併軟刪，再封存家戶。
 * 若還有「草稿報名／未收款」等阻擋，仍會擋下並回報原因（不強刪有實際資料的戶）。
 * 預覽（commit=false）只讀取、列出裡面有什麼；commit=true 才實際封存。全部可還原。
 */

export type ArchiveHouseholdRow = {
  code: string; found: boolean; householdName: string | null;
  memberNames: string[]; blockers: string[];
  archivedMembers?: number; archivedHousehold?: boolean; error?: string;
};
export type ArchiveHouseholdsReport = { ok: boolean; commit: boolean; rows: ArchiveHouseholdRow[] };

export async function archiveHouseholdsByCode(
  codes: string[],
  opts: { commit: boolean; operatorName: string | null }
): Promise<ArchiveHouseholdsReport> {
  const commit = !!opts.commit;
  const rows: ArchiveHouseholdRow[] = [];

  for (const raw of codes) {
    const code = raw.trim();
    if (!code) continue;
    const hh = await prisma.household.findUnique({
      where: { id: code },
      select: { id: true, name: true, deletedAt: true, members: { where: { deletedAt: null }, select: { id: true, name: true } } },
    });
    if (!hh) { rows.push({ code, found: false, householdName: null, memberNames: [], blockers: ["查無此家戶編號"] }); continue; }
    if (hh.deletedAt) { rows.push({ code, found: true, householdName: hh.name, memberNames: [], blockers: ["這一戶已經封存了"] }); continue; }

    const memberNames = hh.members.map((m) => m.name);
    // 阻擋檢查（草稿報名／未收款——移除成員也擋不掉，先讓使用者知道）。
    const preview = await previewHouseholdArchive(code).catch(() => null);
    const hardBlockers = (preview?.blockers ?? []).filter((b) => !b.includes("在戶成員"));

    if (!commit) {
      rows.push({ code, found: true, householdName: hh.name, memberNames, blockers: hardBlockers });
      continue;
    }

    // commit：若有非成員的硬阻擋（草稿報名／未收款）→ 不動、回報。
    if (hardBlockers.length > 0) {
      rows.push({ code, found: true, householdName: hh.name, memberNames, blockers: hardBlockers, error: `未封存：${hardBlockers.join("；")}` });
      continue;
    }
    try {
      let archivedMembers = 0;
      for (const m of hh.members) { await archiveMember(m.id, opts.operatorName); archivedMembers++; }
      await archiveHousehold(code, "系統：V37 依編號封存空殼/重複家戶", opts.operatorName);
      // V38：封存後連同該戶「未收款、未列印」的普渡報名一起軟刪，讓列印／名單／總數一致地少掉。
      //   已收款／已列印者不動（如實保留），避免隱藏金錢／已印資料。
      await purgeArchivedHouseholdUsRecords({ householdIds: [code], commit: true, operatorName: opts.operatorName }).catch(() => null);
      rows.push({ code, found: true, householdName: hh.name, memberNames, blockers: [], archivedMembers, archivedHousehold: true });
    } catch (e) {
      rows.push({ code, found: true, householdName: hh.name, memberNames, blockers: hardBlockers, error: e instanceof Error ? e.message : "封存時發生錯誤" });
    }
  }

  return { ok: rows.every((r) => !r.error), commit, rows };
}
