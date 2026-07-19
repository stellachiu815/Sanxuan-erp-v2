import { getZodiacByLunarYear, solarToLunar } from "@/lib/lunar";

/**
 * V11.3「信眾資料匯入預檢中心」——資料正規化（需求「第四步」）。
 *
 * 這個檔案刻意不 import Prisma、不碰資料庫，純函式，方便在沙盒環境裡直接
 * 用簡單的呼叫驗證行為（不需要接資料庫）。所有函式都「不會丟出例外」——
 * 輸入看不懂就回傳 null／false 加上一句錯誤或警告文字，不會讓呼叫端因為
 * 單一欄位崩潰（需求「不得因為單一欄錯誤造成整頁程式崩潰」）。
 *
 * 農曆／生肖換算沿用既有 src/lib/lunar.ts（跟 src/lib/importRules.ts 既有
 * 家戶批次匯入、devoteeBirthday.ts 用的是同一套底層邏輯），沒有另外寫一套。
 */

// ============================================================
// 一、文字基礎正規化
// ============================================================

/** 姓名前後空白（含全形空白）。 */
export function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/^[\s　]+|[\s　]+$/g, "");
}

/** 全形數字轉半形（其餘全形符號不動，避免誤傷地址/備註裡的中文標點）。 */
export function toHalfWidthDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 電話／手機：移除空白、括號、連字號，全形數字轉半形，保留數字與前導 +。 */
export function normalizePhone(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return null;
  const cleaned = s.replace(/[\s()（）\-－—]/g, "");
  if (!cleaned) return null;
  // 只允許數字與最前面一個 +（國際碼），其餘看不懂的字元一律濾掉而不是拒絕整欄，
  // 避免因為儲存格裡混了奇怪符號就把整列判定成格式錯誤。
  const digitsOnly = cleaned.replace(/(?!^\+)[^\d]/g, "");
  return digitsOnly || null;
}

/** 一般文字欄位（地址／備註／公司名稱等）：只做 trim，空字串轉 null。 */
export function toNullableText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const s = toHalfWidthDigits(String(raw)).trim();
  return s.length > 0 ? s : null;
}

// ============================================================
// 二、性別／往生標記——同義詞正規化
// ============================================================

const GENDER_MALE_ALIASES = new Set(["男", "M", "m", "建生"]);
const GENDER_FEMALE_ALIASES = new Set(["女", "F", "f", "瑞生"]);

/**
 * 性別同義詞正規化（需求「第四步」第 7 點）。看不懂的寫法不會擋匯入，
 * 原樣保留（Member.gender 本來就是自由文字欄位），只是不會特別轉換。
 */
export function normalizeGender(raw: unknown): string | null {
  const s = toNullableText(raw);
  if (!s) return null;
  if (GENDER_MALE_ALIASES.has(s)) return "男";
  if (GENDER_FEMALE_ALIASES.has(s)) return "女";
  return s;
}

const DECEASED_TRUE_ALIASES = new Set(["往生", "已故", "歿", "是", "true", "TRUE", "Y", "y", "1"]);
const DECEASED_FALSE_ALIASES = new Set(["否", "尚在", "在世", "false", "FALSE", "N", "n", "0", ""]);

export type ParsedBoolean = { value: boolean; warning: string | null };

/** 往生標記同義詞正規化（需求「第四步」第 8 點）。看不懂的寫法視為「否」並附警告，不擋匯入。 */
export function normalizeDeceasedFlag(raw: unknown, fieldLabel = "是否往生"): ParsedBoolean {
  const s = toNullableText(raw) ?? "";
  if (DECEASED_TRUE_ALIASES.has(s)) return { value: true, warning: null };
  if (DECEASED_FALSE_ALIASES.has(s)) return { value: false, warning: null };
  return { value: false, warning: `「${fieldLabel}」看不懂內容「${s}」，已當作「否」處理，請確認是否正確` };
}

// ============================================================
// 三、年份／日期
// ============================================================

/**
 * 民國年／西元年判斷（需求「第四步」第 4 點）：溫和的啟發式規則——
 * 現存信眾／家戶成員的出生西元年不太可能小於 1000，所以小於 1000 的數字
 * 一律當成民國年換算成西元年；大於等於 1000 直接當西元年，不做轉換。
 */
export function resolveMaybeRocYear(year: number): number {
  return year < 1000 ? year + 1911 : year;
}

export type ParsedDateResult = { date: Date | null; error: string | null };

/**
 * 國曆生日：接受 Excel 日期儲存格（xlsx 套件 cellDates:true 讀出的原生
 * Date），或 yyyy-MM-dd / yyyy/MM/dd / yyyy.MM.dd 文字，年份支援民國年
 * （需求「第四步」第 4、5 點）。
 */
export function parseFlexibleSolarDate(raw: unknown, fieldLabel = "國曆生日"): ParsedDateResult {
  if (raw === null || raw === undefined || raw === "") return { date: null, error: null };
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { date: null, error: `「${fieldLabel}」日期格式看不懂` };
    return { date: new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate())), error: null };
  }
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return { date: null, error: null };
  const m = s.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return { date: null, error: `「${fieldLabel}」格式看不懂「${s}」，請用 yyyy-MM-dd（西元或民國年皆可）` };
  const year = resolveMaybeRocYear(Number(m[1]));
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { date: null, error: `「${fieldLabel}」日期不合理「${s}」` };
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return { date: null, error: `「${fieldLabel}」日期不存在「${s}」` };
  }
  return { date, error: null };
}

export type ParsedLunarDateResult = {
  lunar: { year: number; month: number; day: number; isLeapMonth: boolean } | null;
  error: string | null;
};

/** 農曆生日（合併欄位）：yyyy-MM-dd 或 yyyy/MM/dd，閏月請加「(閏)」，年份支援民國年。 */
export function parseFlexibleLunarDate(raw: unknown, fieldLabel = "農曆生日"): ParsedLunarDateResult {
  if (raw === null || raw === undefined || raw === "") return { lunar: null, error: null };
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return { lunar: null, error: null };
  const isLeapMonth = s.includes("閏");
  const cleaned = s.replace(/[（(]?閏[）)]?/g, "").trim();
  const m = cleaned.match(/^(\d{1,4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) {
    return { lunar: null, error: `「${fieldLabel}」格式看不懂「${s}」，請用 yyyy-MM-dd，閏月請加「(閏)」` };
  }
  const year = resolveMaybeRocYear(Number(m[1]));
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 30) {
    return { lunar: null, error: `「${fieldLabel}」日期不合理「${s}」` };
  }
  return { lunar: { year, month, day, isLeapMonth }, error: null };
}

/** 農曆生日（拆分成「農曆出生月」／「農曆出生日」兩欄時使用，沒有年份可填，年份留空）。 */
export function parseFlexibleLunarMonthDay(
  monthRaw: unknown,
  dayRaw: unknown
): { month: number | null; day: number | null; error: string | null } {
  const monthText = toNullableText(monthRaw);
  const dayText = toNullableText(dayRaw);
  if (!monthText && !dayText) return { month: null, day: null, error: null };
  const month = monthText ? Number(toHalfWidthDigits(monthText)) : null;
  const day = dayText ? Number(toHalfWidthDigits(dayText)) : null;
  if (month !== null && (!Number.isInteger(month) || month < 1 || month > 12)) {
    return { month: null, day: null, error: "「農曆出生月」請填 1～12 之間的數字" };
  }
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 30)) {
    return { month: null, day: null, error: "「農曆出生日」請填 1～30 之間的數字" };
  }
  return { month, day, error: null };
}

/** 生肖只是交叉核對用的提醒，不會擋匯入（跟既有 importRules.ts 慣例一致）。 */
export function checkZodiacConsistency(
  zodiacInput: string | null,
  solarDate: Date | null,
  lunar: { year: number } | null
): string | null {
  if (!zodiacInput) return null;
  let lunarYear: number | null = null;
  if (solarDate) lunarYear = solarToLunar(solarDate).year;
  else if (lunar) lunarYear = lunar.year;
  if (!lunarYear) return null;
  const computed = getZodiacByLunarYear(lunarYear);
  if (computed !== zodiacInput) {
    return `「生肖」欄位填「${zodiacInput}」，但系統依生日換算為「${computed}」，請確認`;
  }
  return null;
}
