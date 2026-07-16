/**
 * 祭改（及其他宮務列印）虛歲計算（V9.0「祭改管理與小人頭貼紙列印」新增）。
 *
 * 純函式、不 import lunar.ts / lunar-javascript，方便在沙盒環境用
 * `tsx --test` 直接執行自動測試（見 tests/purificationAge.test.ts）。
 *
 * 「出生農曆年份 → 虛歲」這一段純算術邏輯放在這裡；「國曆生日 → 農曆年份」
 * 的換算則需要 lunar-javascript，那一段留在 src/lib/purification.ts
 * （會 import src/lib/lunar.ts），本檔案不碰。
 *
 * 核心規則（對應需求「四、歲數計算規則」）：
 * 1. 虛歲 = 目標年度的農曆年 − 出生農曆年 + 1，每次查詢/列印當下都重新計算，
 *    不得存成固定數字，也不可以由使用者每年手動修改。
 * 2. 民國年換算西元年固定用「民國年 + 1911」（跟這個專案其他地方，例如
 *    src/lib/ritual.ts 的 getCurrentRitualYear，換算方向一致），把這個
 *    當作「目標農曆年」的近似值——這是這個專案從 V2.0 起就採用的簡化
 *    慣例（不逐日判斷農曆新年切換），祭改本來就是排定在固定期間舉行的
 *    年度活動，這個近似對這個用途已經足夠準確。
 * 3. 出生年份不完整、或算出來的歲數不合理（例如負數或超過合理人類壽命），
 *    一律回傳「無法計算」，交給呼叫端列入待確認清單，不自行猜測或校正。
 */

/** 最高允許的合理虛歲，超過這個值視為資料異常（例如出生年份打錯），要列入待確認清單。 */
const MAX_REASONABLE_AGE = 130;

/** 民國年份 → 西元年份（近似，見檔案開頭說明）。 */
export function minguoYearToADYear(minguoYear: number): number {
  return minguoYear + 1911;
}

/**
 * 虛歲計算的核心算術：目標農曆年（西元）− 出生農曆年（西元）+ 1。
 * 這是唯一「真正的計算」，其餘函式都只是包一層輸入驗證與資料完整性判斷。
 */
export function calculateNominalAge(birthLunarYear: number, targetLunarYearAD: number): number {
  return targetLunarYearAD - birthLunarYear + 1;
}

export type AgeResolution =
  | { ok: true; age: number }
  | { ok: false; reason: string };

/**
 * 依「出生農曆年」與「祭改年度（民國年）」算出虛歲，並做合理性檢查。
 * birthLunarYear 為 null/undefined（代表出生年份資料不完整），或算出來的
 * 歲數不合理，都回傳 { ok: false }，呼叫端應該把這一筆列入待確認清單，
 * 不得列印、也不得自行猜測一個數字頂替。
 */
export function resolveNominalAgeForMinguoYear(
  birthLunarYear: number | null | undefined,
  targetMinguoYear: number
): AgeResolution {
  if (birthLunarYear === null || birthLunarYear === undefined) {
    return { ok: false, reason: "出生年份不完整，無法計算歲數" };
  }
  if (!Number.isInteger(birthLunarYear) || birthLunarYear < 1800) {
    return { ok: false, reason: "出生年份資料異常，無法計算歲數" };
  }
  const targetLunarYearAD = minguoYearToADYear(targetMinguoYear);
  const age = calculateNominalAge(birthLunarYear, targetLunarYearAD);
  if (age < 1 || age > MAX_REASONABLE_AGE) {
    return { ok: false, reason: `計算出的歲數（${age}）不合理，請確認出生年份是否正確` };
  }
  return { ok: true, age };
}
