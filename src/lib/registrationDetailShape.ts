/**
 * V30.7 信眾活動明細「列的形狀」純函式（無 Prisma，便於單元測試）。
 * 用來保證：基本/額外寶袋正確分辨、免費不計價、DRAFT/CANCELLED 不混入有效區、金額不重複。
 */

export type DetailSection = "ACTIVE" | "DRAFT" | "CANCELLED";

/** 報名/列印物件狀態 → 顯示分區。CONFIRMED（及其他）→ ACTIVE；DRAFT→草稿；CANCELLED→歷史。 */
export function rowSection(status: string): DetailSection {
  if (status === "CANCELLED") return "CANCELLED";
  if (status === "DRAFT") return "DRAFT";
  return "ACTIVE";
}

/** 寶袋顯示：基本（免費）vs 額外（依 isChargeable）。 */
export function pocketDisplay(isExtra: boolean, isChargeable: boolean): { kind: "BASIC" | "EXTRA"; itemName: string; feeLabel: string } {
  return {
    kind: isExtra ? "EXTRA" : "BASIC",
    itemName: isExtra ? "增加寶袋" : "基本寶袋",
    feeLabel: isChargeable ? "收費" : "免費",
  };
}

/** 寶袋應收：收費＝小計；不收費/基本＝0（免費仍可列印，但不計應收）。 */
export function pocketAmountDue(isChargeable: boolean, subtotal: number): number {
  return isChargeable ? Math.max(0, subtotal) : 0;
}

/**
 * 明細金額彙總：只加總「非取消（ACTIVE/DRAFT）」列，避免把已取消歷史計入；
 * US_POCKET_EXTRA 報名項目已在查詢層排除，寶袋金額只來自寶袋列印物件列 → 不重複計算。
 */
export function summarizeAmounts(rows: { section: DetailSection; amountDue: number; amountPaid: number; amountUnpaid: number }[]) {
  const active = rows.filter((r) => r.section !== "CANCELLED");
  return {
    amountDue: active.reduce((s, r) => s + r.amountDue, 0),
    amountPaid: active.reduce((s, r) => s + r.amountPaid, 0),
    amountUnpaid: active.reduce((s, r) => s + r.amountUnpaid, 0),
  };
}
