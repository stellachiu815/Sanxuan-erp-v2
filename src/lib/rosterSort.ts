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
