/**
 * V31 牌位／寶袋列印欄位解析（純函式，無 Prisma，便於單元測試）。
 * 單一真值來源，供明細畫面／活動總名單／Excel／預覽／正式列印一致使用。
 */

/**
 * 列印主文：有單筆覆寫（printMainText）就只覆寫這一筆的中間主文；否則沿用系統正式主文（已 formatter）。
 * 不改分類/收款/統計/registrationItemType。
 */
export function resolvePrintMainText(formattedDefault: string, printMainText: string | null | undefined): string {
  const override = (printMainText ?? "").trim();
  return override || formattedDefault;
}

/**
 * 普渡牌位／寶袋列印地址來源（**絕不** fallback Household.address；Household.address 只給全家燈）：
 *   1. 已保存的 entry.tabletAddress／列印快照優先。
 *   2. 否則使用該筆對應 Member.address。
 *   3. 皆無 → 空字串（畫面顯示缺地址，不硬帶家戶地址）。
 */
export function resolvePrintAddress(entryTabletAddress: string | null | undefined, memberAddress: string | null | undefined): string {
  const entry = (entryTabletAddress ?? "").trim();
  if (entry) return entry;
  const member = (memberAddress ?? "").trim();
  if (member) return member;
  return "";
}

/**
 * §5 需補印判定：已列印（printCount>0）且列印後又被編輯（editedAt > printedAt）→ 需補印。
 * editedAt 取「內容最後變更時間」（item.updatedAt 或 entry.updatedAt 之較晚者），涵蓋 workOrder／
 * printMainText／地址／陽上／牌位名稱等變更。未列印或列印後未再改 → false。不重設首次 printedAt。
 */
export function needsReprint(printCount: number, printedAtISO: string | null, editedAtISO: string | null): boolean {
  if ((printCount ?? 0) <= 0) return false;
  if (!printedAtISO || !editedAtISO) return false;
  return new Date(editedAtISO).getTime() > new Date(printedAtISO).getTime() + 1000; // 1s 容差
}

/** 取多個 ISO 時間字串中最晚者（忽略 null/undefined）；全空回 null。供「內容最後變更時間」彙整。 */
export function latestIso(...isos: (string | null | undefined)[]): string | null {
  let best: number | null = null;
  let bestIso: string | null = null;
  for (const s of isos) {
    if (!s) continue;
    const t = new Date(s).getTime();
    if (Number.isNaN(t)) continue;
    if (best === null || t > best) { best = t; bestIso = s; }
  }
  return bestIso;
}
