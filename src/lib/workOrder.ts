/**
 * V31 正式作業編號 workOrder（純函式，無 Prisma，便於單元測試）。
 *
 * workOrder＝正式列印號，與 registrationOrder **完全分離**：
 *   - registrationOrder：永久保留，僅供歷史／建立順序／查核，不因列印調整而變。
 *   - workOrder：Excel／總名單／裁切牌位／裁切寶袋／補印一律使用。
 * 每一種報名項目（registrationItemType.key）**各自** 1..N，不跨類別接續（祖先 1..N、冤親 1..N…）。
 * 寶袋（基本＋額外）共用「寶袋」自己的 1..N（以 US_POCKET_EXTRA 為類別鍵）。
 */

export type WorkOrderRow = {
  id: string;
  /** 類別鍵（registrationItemType.key）；同鍵共用一條 1..N 序列。 */
  categoryKey: string;
  /** 目前 workOrder（尚未產生為 null）。 */
  workOrder: number | null;
};

/** 列印號來源：優先 workOrder；尚未產生時安全回退 registrationOrder（不影響既有顯示）。 */
export function printNumberOf(workOrder: number | null | undefined, registrationOrder: number | null | undefined): number | null {
  return workOrder ?? registrationOrder ?? null;
}

/**
 * 自動產生正式作業號（第一次進入）：**已有 workOrder 者不覆蓋**；缺號者依目前排序，於「同類別」內
 * 接續現有最大號往下補（1..N）。回傳需寫入的 {id, workOrder}（只含本次新指派者）。
 * @param rows 依「目前畫面排序」傳入（同類別內順序＝補號順序）。
 */
export function autoAssignWorkOrders(rows: WorkOrderRow[]): { id: string; workOrder: number }[] {
  const maxByCat = new Map<string, number>();
  for (const r of rows) {
    if (r.workOrder != null) maxByCat.set(r.categoryKey, Math.max(maxByCat.get(r.categoryKey) ?? 0, r.workOrder));
  }
  const out: { id: string; workOrder: number }[] = [];
  for (const r of rows) {
    if (r.workOrder != null) continue; // 已有號不覆蓋
    const next = (maxByCat.get(r.categoryKey) ?? 0) + 1;
    maxByCat.set(r.categoryKey, next);
    out.push({ id: r.id, workOrder: next });
  }
  return out;
}

/**
 * 「重新依目前排序編號」：同類別內依傳入順序重編 1..N（覆蓋既有 workOrder）。
 * 回傳每筆的新 workOrder（全部，含未變動者，方便一次寫入）。
 */
export function renumberByCurrentSort(rows: WorkOrderRow[]): { id: string; workOrder: number }[] {
  const counter = new Map<string, number>();
  return rows.map((r) => {
    const n = (counter.get(r.categoryKey) ?? 0) + 1;
    counter.set(r.categoryKey, n);
    return { id: r.id, workOrder: n };
  });
}

/**
 * 人工改號（拖曳／直接輸入）：把某筆改成 targetOrder，於**同類別**內與原本佔用該號者**互換**，
 * 保證不產生重號。回傳受影響筆的新 workOrder（通常 2 筆：本筆與被換筆）。
 * - 目標號不存在（超出目前範圍）→ 只設定本筆，不動他人。
 * - 本筆與目標同類別才互換；跨類別不處理（各類別獨立）。
 */
export function swapWorkOrder(rows: WorkOrderRow[], id: string, targetOrder: number): { id: string; workOrder: number }[] {
  const self = rows.find((r) => r.id === id);
  if (!self) return [];
  if (targetOrder < 1) return [];
  const holder = rows.find((r) => r.id !== id && r.categoryKey === self.categoryKey && r.workOrder === targetOrder);
  if (!holder) {
    return [{ id: self.id, workOrder: targetOrder }];
  }
  const from = self.workOrder;
  const updates: { id: string; workOrder: number }[] = [{ id: self.id, workOrder: targetOrder }];
  // 被換筆拿回本筆原本的號；若本筆原本無號，則不指派給被換筆（避免製造 null→數字的錯配）。
  if (from != null) updates.push({ id: holder.id, workOrder: from });
  return updates;
}

/** 驗證一批 workOrder 在各類別內無重號、無 <1。 */
export function hasNoDuplicateWorkOrders(rows: WorkOrderRow[]): boolean {
  const seen = new Map<string, Set<number>>();
  for (const r of rows) {
    if (r.workOrder == null) continue;
    if (r.workOrder < 1) return false;
    const set = seen.get(r.categoryKey) ?? new Set<number>();
    if (set.has(r.workOrder)) return false;
    set.add(r.workOrder);
    seen.set(r.categoryKey, set);
  }
  return true;
}
