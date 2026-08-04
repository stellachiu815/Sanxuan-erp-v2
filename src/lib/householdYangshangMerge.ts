/**
 * V36-H：家戶合併時「固定陽上人名單（HouseholdYangshang）」搬移去重的**純函式**。
 * 不 import Prisma，供 mergeHouseholds() 與單元測試共用同一份規則。
 *
 * 規則：來源戶的固定陽上人搬到目標戶；但因 HouseholdYangshang 有
 *   @@unique([householdId, name])，名稱已存在於目標戶者不可搬（會撞唯一鍵），
 *   一律略過（留在已封存的來源戶，不遺失、不重複）。名稱比對以 trim 後字串相等。
 */
export type YangshangRow = { id: string; name: string };

export function partitionYangshangForMerge(
  targetNames: readonly string[],
  sourceRows: readonly YangshangRow[]
): { toMove: YangshangRow[]; skipped: YangshangRow[] } {
  const existing = new Set(targetNames.map((n) => (n ?? "").trim()));
  const toMove: YangshangRow[] = [];
  const skipped: YangshangRow[] = [];
  for (const row of sourceRows) {
    if (existing.has((row.name ?? "").trim())) skipped.push(row);
    else {
      toMove.push(row);
      // 同批次來源內也可能有重名，移動後即視為已存在，避免自身撞鍵。
      existing.add((row.name ?? "").trim());
    }
  }
  return { toMove, skipped };
}
