import { prisma } from "@/lib/prisma";
import type { WorshipType } from "@prisma/client";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.14 家戶「永久牌位名單」重複審閱清理（瀏覽器可觸發）。
 *
 * 舊同步用「姓名＋地址」判重，地址一不同就多開 → 永久名單同一姓長出多張（雲林=對、新北=系統胡亂新增）。
 *
 * 本工具：把「同家戶＋同類別＋同核心名」的多張列成一組，**每張都顯示主文/陽上人/地址/建立時間**，
 * 讓你（或預設）挑出要保留的那張，其餘封存（軟刪 deletedAt，可還原）。
 *   - 預設保留＝**最早建立**那張（多為原始正確資料）。
 *   - 你也可以自己勾要留哪張（同姓真的有不同支時可留多張）。
 * 冤親／無緣不在永久名單，不受影響。
 *
 * 預覽（commit=false）：回各組與預設保留；commit=true＋keepIds：封存重複組中「未被保留」的那些。
 */

const CORE_TYPES = ["ANCESTOR_LINE", "INDIVIDUAL"] as unknown as WorshipType[];
const TYPE_TO_CATEGORY: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL_SOUL"> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL: "INDIVIDUAL_SOUL",
};

export type WorshipRec = { id: string; displayName: string; location: string | null; yangshang: string | null; createdAt: string };
export type WorshipDupGroup = { householdId: string; type: string; coreName: string; suggestedKeepId: string; records: WorshipRec[] };
export type CleanupWorshipReport = {
  ok: boolean; commit: boolean; totalWorshipRecords: number;
  duplicateGroups: number; archivedCount?: number; groups: WorshipDupGroup[]; error?: string;
};

export async function cleanupWorshipDuplicates(opts: { commit: boolean; keepIds?: string[] }): Promise<CleanupWorshipReport> {
  const commit = !!opts.commit;
  const records = await prisma.worshipRecord.findMany({
    where: { deletedAt: null, type: { in: CORE_TYPES } },
    select: { id: true, householdId: true, type: true, displayName: true, location: true, yangshangName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });

  const groupsMap = new Map<string, typeof records>();
  for (const r of records) {
    const cat = TYPE_TO_CATEGORY[r.type];
    const core = normalizeTabletText(normalizeRitualNameForStore(cat, r.displayName));
    if (!core) continue;
    const key = `${r.householdId}|${r.type}|${core}`;
    const arr = groupsMap.get(key) ?? [];
    arr.push(r); groupsMap.set(key, arr);
  }

  const groups: WorshipDupGroup[] = [];
  for (const [key, arr] of groupsMap) {
    if (arr.length <= 1) continue;
    const [householdId, type, coreName] = key.split("|");
    const sorted = [...arr].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    groups.push({
      householdId, type, coreName, suggestedKeepId: sorted[0].id,
      records: sorted.map((r) => ({ id: r.id, displayName: r.displayName, location: r.location, yangshang: r.yangshangName, createdAt: r.createdAt.toISOString() })),
    });
  }
  groups.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));

  const base: CleanupWorshipReport = { ok: true, commit, totalWorshipRecords: records.length, duplicateGroups: groups.length, groups };
  if (!commit) return base;

  // 保留集合：呼叫端傳來的 keepIds（每組至少留一張）；未傳則預設每組留最早那張。
  const keep = new Set(opts.keepIds && opts.keepIds.length ? opts.keepIds : groups.map((g) => g.suggestedKeepId));
  const archiveIds: string[] = [];
  for (const g of groups) {
    const groupKept = g.records.filter((r) => keep.has(r.id));
    const finalKept = groupKept.length ? groupKept : [g.records[0]]; // 保底：至少留一張（最早）
    for (const r of g.records) if (!finalKept.some((k) => k.id === r.id)) archiveIds.push(r.id);
  }
  if (archiveIds.length === 0) return { ...base, archivedCount: 0 };
  await prisma.worshipRecord.updateMany({
    where: { id: { in: archiveIds } },
    data: { deletedAt: new Date(), deletedByName: "系統：V36.14 永久牌位重複審閱清理" },
  });
  return { ...base, archivedCount: archiveIds.length };
}
