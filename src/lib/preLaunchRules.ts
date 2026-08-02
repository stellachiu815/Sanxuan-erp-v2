/**
 * V30.8 上線前檢查／smoke 的純規則（無 Prisma，便於單元測試）。
 * 核心：**已取消（CANCELLED）項目不做正式資料檢查、不阻擋上線。**
 */

/**
 * 是否為「金額異常」。
 * - CANCELLED：一律 false——取消後 amountUnpaid=0 是正確狀態，即使保留原 amountDue 也不屬財務異常。
 * - 其他：金額為負，或 (amountDue − amountPaid) ≠ amountUnpaid → 異常。
 */
export function isAmountAnomaly(status: string, amountDue: number, amountPaid: number, amountUnpaid: number): boolean {
  if (status === "CANCELLED") return false;
  if (amountDue < 0 || amountPaid < 0 || amountUnpaid < 0) return true;
  return Math.abs((amountDue - amountPaid) - amountUnpaid) > 0.001;
}

/**
 * smoke test 的「阻擋上線」分類——**只含有效、未取消的正式資料問題**。
 * 不含任何 CANCELLED 衍生項（已取消歷史、已刪除仍有應收）與整備期正常項（DRAFT／空 record）。
 */
export const SMOKE_BLOCKING_CATEGORIES: ReadonlySet<string> = new Set([
  "孤兒 entry（無 item）",
  "牌位 item 缺 entry",
  "registrationOrder 重複",
  "金額異常",
]);

export function isSmokeBlocking(category: string): boolean {
  return SMOKE_BLOCKING_CATEGORIES.has(category);
}
