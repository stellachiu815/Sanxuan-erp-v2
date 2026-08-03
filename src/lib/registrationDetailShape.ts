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

/**
 * §10 寶袋群組化（純 UI 分組，不合併/刪除任何列印物件）：牌位為主，其基本/額外寶袋（parentEntryId
 * ＝牌位 entryId）掛在其下；無法配對（parentEntryId=null 或找不到牌位）的寶袋進「未配對」區。
 * 白米/贊普等非牌位非寶袋列為 others。保證：groups.tablet + groups.pockets + unpaired + others = 原列數（不漏不重）。
 */
export function groupRowsForDisplay<T extends { id: string; kind: string; parentEntryId: string | null }>(rows: T[]) {
  const tablets = rows.filter((r) => r.kind === "TABLET");
  const pockets = rows.filter((r) => r.kind === "POCKET");
  const others = rows.filter((r) => r.kind !== "TABLET" && r.kind !== "POCKET");
  const groups = tablets.map((t) => ({
    tablet: t,
    pockets: pockets.filter((p) => p.parentEntryId != null && t.parentEntryId != null && p.parentEntryId === t.parentEntryId),
  }));
  const grouped = new Set(groups.flatMap((g) => g.pockets.map((p) => p.id)));
  const unpairedPockets = pockets.filter((p) => !grouped.has(p.id));
  return { groups, unpairedPockets, others };
}

export type DetailCategoryRow = {
  kind: string; // TABLET/RICE/SPONSOR/POCKET/OTHER
  itemName: string; // 正式名稱
  section: DetailSection;
  quantity: number;
  pocketKind: "BASIC" | "EXTRA" | null;
};

/**
 * 信眾活動摘要（§3）：**只統計有效（非 DRAFT／非 CANCELLED）** 資料。
 * 牌位／贊普顯示筆數（不是 quantity 加總）；白米顯示總斤數；基本／額外寶袋分開統計。
 * 另回 draft／cancelled 筆數供 Badge（不混入有效摘要）。
 */
export function summarizeByCategory(rows: DetailCategoryRow[]) {
  const active = rows.filter((r) => r.section === "ACTIVE");
  const tabletCounts = new Map<string, number>(); // itemName → 筆數
  const sponsorCounts = new Map<string, number>();
  let riceKg = 0;
  let basicPocket = 0;
  let extraPocket = 0;
  for (const r of active) {
    if (r.kind === "TABLET") tabletCounts.set(r.itemName, (tabletCounts.get(r.itemName) ?? 0) + 1);
    else if (r.kind === "RICE") riceKg += r.quantity;
    else if (r.kind === "SPONSOR") sponsorCounts.set(r.itemName, (sponsorCounts.get(r.itemName) ?? 0) + 1);
    else if (r.kind === "POCKET") {
      if (r.pocketKind === "EXTRA") extraPocket += 1;
      else basicPocket += 1;
    }
  }
  return {
    tablets: [...tabletCounts.entries()].map(([itemName, count]) => ({ itemName, count })),
    sponsors: [...sponsorCounts.entries()].map(([itemName, count]) => ({ itemName, count })),
    riceKg,
    basicPocket,
    extraPocket,
    draftCount: rows.filter((r) => r.section === "DRAFT").length,
    cancelledCount: rows.filter((r) => r.section === "CANCELLED").length,
  };
}
