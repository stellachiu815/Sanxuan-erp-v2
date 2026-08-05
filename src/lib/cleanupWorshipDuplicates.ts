import { prisma } from "@/lib/prisma";
import type { WorshipType } from "@prisma/client";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.14 家戶「永久牌位名單」重複清理（可由瀏覽器 API 觸發）。
 *
 * 背景：舊的同步邏輯用「姓名＋地址」判重，地址一不同就多開一張 → 永久名單出現同一姓多張
 * （例：吳姓歷代祖先・雲林＝對、吳姓歷代祖先・新北＝系統胡亂新增）。
 *
 * 規則：同一「家戶＋類別(type)＋核心名」視為同一張。**保留最早建立的一張（多為原始正確資料）**，
 * 其餘（後來被胡亂多開的）**封存（軟刪 deletedAt，可還原）**。冤親／無緣不在永久名單，不受影響。
 *
 * commit=false（預設）＝預覽：只回「哪些會保留、哪些會封存」，不寫入。
 * commit=true ＝實際封存（軟刪，可從回收/還原）。
 */

const CORE_TYPES = ["ANCESTOR_LINE", "INDIVIDUAL"] as unknown as WorshipType[]; // WorshipRecord.type
const TYPE_TO_CATEGORY: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL_SOUL"> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL: "INDIVIDUAL_SOUL",
};

export type WorshipDupGroup = {
  householdId: string;
  type: string;
  coreName: string;
  keep: { id: string; displayName: string; location: string | null; createdAt: string };
  archive: { id: string; displayName: string; location: string | null; createdAt: string }[];
};

export type CleanupWorshipReport = {
  ok: boolean;
  commit: boolean;
  totalWorshipRecords: number;
  duplicateGroups: number;
  toArchive: number;
  groups: WorshipDupGroup[];
  error?: string;
};

export async function cleanupWorshipDuplicates(opts: { commit: boolean; householdId?: string | null }): Promise<CleanupWorshipReport> {
  const commit = !!opts.commit;
  const records = await prisma.worshipRecord.findMany({
    where: { deletedAt: null, type: { in: CORE_TYPES }, ...(opts.householdId ? { householdId: opts.householdId } : {}) },
    select: { id: true, householdId: true, type: true, displayName: true, location: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  // 依 家戶＋type＋核心名 分組。
  const groupsMap = new Map<string, typeof records>();
  for (const r of records) {
    const cat = TYPE_TO_CATEGORY[r.type];
    const core = normalizeTabletText(normalizeRitualNameForStore(cat, r.displayName));
    if (!core) continue;
    const key = `${r.householdId}|${r.type}|${core}`;
    const arr = groupsMap.get(key) ?? [];
    arr.push(r);
    groupsMap.set(key, arr);
  }

  const groups: WorshipDupGroup[] = [];
  let toArchive = 0;
  const archiveIds: string[] = [];
  for (const [key, arr] of groupsMap) {
    if (arr.length <= 1) continue; // 沒有重複
    const [householdId, type, coreName] = key.split("|");
    const sorted = [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const keep = sorted[0]; // 最早建立者
    const rest = sorted.slice(1);
    for (const r of rest) archiveIds.push(r.id);
    toArchive += rest.length;
    groups.push({
      householdId, type, coreName,
      keep: { id: keep.id, displayName: keep.displayName, location: keep.location, createdAt: keep.createdAt.toISOString() },
      archive: rest.map((r) => ({ id: r.id, displayName: r.displayName, location: r.location, createdAt: r.createdAt.toISOString() })),
    });
  }
  groups.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));

  const base: CleanupWorshipReport = {
    ok: true, commit, totalWorshipRecords: records.length,
    duplicateGroups: groups.length, toArchive, groups,
  };
  if (!commit || archiveIds.length === 0) return base;

  await prisma.$transaction(async (tx) => {
    await tx.worshipRecord.updateMany({
      where: { id: { in: archiveIds } },
      data: { deletedAt: new Date(), deletedByName: "系統：V36.14 永久牌位重複清理" },
    });
  });
  return base;
}
