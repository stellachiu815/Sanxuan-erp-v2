/**
 * V25 正式信眾資料權威同步：個人地址 vs 家戶地址的唯一解析規則。
 *
 * ── 永久架構 ──
 * 系統有兩個各自獨立、不得互相覆蓋的地址：
 *   - Member.address     信眾**個人**通訊地址（正式信眾 Excel 為最高權威來源）
 *   - Household.address   **家戶共用**地址（正式家戶 Excel 為權威來源）
 *
 * 顯示規則（唯一入口，所有「顯示某位信眾地址」的地方都走這裡）：
 *   1. 個人地址有值 → 顯示個人地址。
 *   2. 個人地址空白 → 才 fallback 顯示家戶地址（**僅顯示**，不得寫回 Member）。
 *
 * ⚠️ fallback 只影響畫面呈現與便利帶入，永遠不得把家戶地址寫進 Member.address。
 * 個人地址一旦有值，家戶地址不得覆蓋它。
 */

/** 去除前後空白（含全形空白）；空字串視為未填。 */
function cleanAddress(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/^[\s　]+|[\s　]+$/g, "");
  return s.length > 0 ? s : null;
}

/**
 * 解析「要顯示給使用者看的信眾地址」。
 * @returns { address, source } — source 標示這個地址來自個人還是家戶 fallback，供畫面標註。
 */
export function resolvePersonalAddress(
  memberAddress: string | null | undefined,
  householdAddress: string | null | undefined
): { address: string | null; source: "personal" | "household" | "none" } {
  const personal = cleanAddress(memberAddress);
  if (personal) return { address: personal, source: "personal" };
  const household = cleanAddress(householdAddress);
  if (household) return { address: household, source: "household" };
  return { address: null, source: "none" };
}

/** 便捷版：只要解析後的地址字串（顯示用）。 */
export function displayPersonalAddress(
  memberAddress: string | null | undefined,
  householdAddress: string | null | undefined
): string | null {
  return resolvePersonalAddress(memberAddress, householdAddress).address;
}
