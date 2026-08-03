/**
 * V30.6 活動總名單排序純函式（client-safe，無 Prisma，便於單元測試）。
 * 依 registrationOrder ASC，NULL 一律排最後（不以姓名／家戶排序）；編號欄 NULL 顯示「—」。
 */

export function orderCell(order: number | null): string | number {
  return order == null ? "—" : order;
}

export function sortByRegistrationOrder<T extends { registrationOrder: number | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ao = a.registrationOrder;
    const bo = b.registrationOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });
}

/**
 * 同一工作表放多種項目時（如祖先＋乙位正魂）：**先依項目正式順序分組、組內再依各自 registrationOrder**。
 * 因此每一種項目的 registrationOrder 各自從自己的號碼呈現，不會混成一條連續序列
 * （祖先 No.1,2…成一區塊，乙位 No.1,2…另一區塊；冤親不接續祖先）。
 */
export function sortByTypeThenOrder<T extends { key: string; registrationOrder: number | null }>(
  rows: T[],
  typeRank: Record<string, number>
): T[] {
  return [...rows].sort((a, b) => {
    const ra = typeRank[a.key] ?? 999;
    const rb = typeRank[b.key] ?? 999;
    if (ra !== rb) return ra - rb;
    const ao = a.registrationOrder;
    const bo = b.registrationOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });
}
