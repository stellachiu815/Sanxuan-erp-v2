/**
 * V13.1 指令二／十三：民國日期的輸入解析與顯示格式化。
 *
 * 純函式、零相依（不 import Prisma、不 import lunar-javascript），可以直接
 * 用 node 執行測試。
 *
 * ── 為什麼需要這一支 ──────────────────────────────────────
 * 專案原本只有 src/lib/lunar.ts 的 parseSolarDateString()，它處理的是
 * **西元** yyyy-MM-dd。但行政人員實際輸入與 Excel 內容大量是民國格式
 * （1140721 / 114/7/21 / 114-7-21），過去只能靠人工換算。這支把「民國
 * 輸入 → 可計算的 Date」與「Date → 民國顯示」收斂成唯一一套，避免各畫面
 * 各寫一份而彼此不一致。
 *
 * ── 邊界決策（誠實說明）──────────────────────────────────
 * 1. 民國年 ↔ 西元年一律 +1911（與 purificationAge.minguoYearToADYear、
 *    ritual.getCurrentRitualYear 同一個換算方向，全專案一致）。
 * 2. 三位數以上的年份視為民國；四位數且 >= 1900 視為西元。這個界線是
 *    刻意的：民國 1900 年不存在，西元 114 年不會出現在宮務資料裡。
 * 3. **不猜測、不補值**（指令十三）。看不懂就回 null，由呼叫端決定要
 *    報錯還是留空，這支絕不「盡量湊出一個看起來像答案的日期」。
 * 4. 一律以 UTC 建構（Date.UTC），與 @db.Date 欄位的儲存慣例一致，
 *    避免 Asia/Taipei 時區造成 off-by-one（V12.2 踩過這個坑）。
 */

/** 民國年 → 西元年。 */
export function minguoToAD(minguoYear: number): number {
  return minguoYear + 1911;
}

/** 西元年 → 民國年。 */
export function adToMinguo(adYear: number): number {
  return adYear - 1911;
}

/** 全形數字 → 半形（Excel 與部分輸入法會產生全形）。 */
function toHalfWidthDigits(s: string): string {
  return s.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/** 以 UTC 建構曆法日期，並驗證年月日沒有被 JS 自動進位（例如 2/30 → 3/2）。 */
function buildUtcDate(y: number, m: number, d: number): Date | null {
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const built = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(built.getTime())) return null;
  // 回推比對：擋掉 2 月 30 日、非閏年 2/29 這類「格式合法但日期不存在」
  if (built.getUTCFullYear() !== y || built.getUTCMonth() !== m - 1 || built.getUTCDate() !== d) {
    return null;
  }
  return built;
}

export type MinguoParseResult =
  | { ok: true; date: Date; minguoYear: number; month: number; day: number }
  | { ok: false; reason: string };

/**
 * 解析使用者／Excel 輸入的日期，支援民國與西元兩種寫法。
 *
 * 支援格式：
 *   民國：1140721 / 114/7/21 / 114-7-21 / 114.7.21 / 民國114年7月21日
 *   西元：2025-07-21 / 2025/7/21 / 20250721
 *   Date 物件（Excel 原生日期）
 *
 * 空白 / null / undefined → { ok: false, reason: "空白" }，呼叫端應存 null，
 * **不得補今天日期**（指令十三）。
 */
export function parseFlexibleDate(raw: unknown): MinguoParseResult {
  if (raw === null || raw === undefined) {
    return { ok: false, reason: "空白" };
  }

  // Excel 原生日期物件。必須先檢查 Invalid Date（V12.9 的教訓：
  // 直接呼叫 getUTCFullYear() 會拿到 NaN，一路傳到 Prisma 才爆炸）。
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return { ok: false, reason: "日期無效" };
    const y = raw.getUTCFullYear();
    const built = buildUtcDate(y, raw.getUTCMonth() + 1, raw.getUTCDate());
    if (!built) return { ok: false, reason: "日期無效" };
    return {
      ok: true,
      date: built,
      minguoYear: adToMinguo(y),
      month: built.getUTCMonth() + 1,
      day: built.getUTCDate(),
    };
  }

  // 數字：只可能是 Excel serial 或 1140721 這種純數字民國日期。
  // 兩者用位數區分——Excel serial 實務範圍是 1～60000 多（約西元 2064 年），
  // 民國純數字日期固定 7 位數（1140721）。
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return { ok: false, reason: "日期無效" };
    if (Number.isInteger(raw) && raw >= 1000101 && raw <= 9991231) {
      return parseFlexibleDate(String(raw));
    }
    return parseExcelSerial(raw);
  }

  const s = toHalfWidthDigits(String(raw))
    .trim()
    .replace(/民國/g, "")
    .replace(/[年月.]/g, "-")
    .replace(/[日號]/g, "")
    .replace(/\//g, "-")
    .replace(/-+$/, "");

  if (!s) return { ok: false, reason: "空白" };

  // 純數字：1140721（民國 7 碼）或 20250721（西元 8 碼）
  const compact = /^(\d{7,8})$/.exec(s);
  if (compact) {
    const digits = compact[1];
    if (digits.length === 7) {
      return finish(Number(digits.slice(0, 3)), Number(digits.slice(3, 5)), Number(digits.slice(5, 7)), true);
    }
    return finish(Number(digits.slice(0, 4)), Number(digits.slice(4, 6)), Number(digits.slice(6, 8)), false);
  }

  // 分隔式：114-7-21 或 2025-07-21
  const parts = /^(\d{1,4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!parts) return { ok: false, reason: `日期格式看不懂「${String(raw)}」` };

  const yearRaw = Number(parts[1]);
  const isMinguo = yearRaw < 1000;
  return finish(yearRaw, Number(parts[2]), Number(parts[3]), isMinguo);

  function finish(year: number, month: number, day: number, minguo: boolean): MinguoParseResult {
    const adYear = minguo ? minguoToAD(year) : year;
    const built = buildUtcDate(adYear, month, day);
    if (!built) return { ok: false, reason: `日期不存在「${String(raw)}」` };
    return {
      ok: true,
      date: built,
      minguoYear: adToMinguo(adYear),
      month,
      day,
    };
  }
}

/**
 * Excel Serial Number → 日期（指令十三）。
 *
 * Excel 的第 1 天是 1900-01-01，但 Excel 錯誤地把 1900 當成閏年（有 2/29），
 * 所以 serial >= 60 之後全部要 −1 天才會正確。這是 Excel 眾所皆知的相容性
 * 缺陷，不是我們的計算錯誤——這裡沿用業界標準的 1899-12-30 基準日處理。
 */
export function parseExcelSerial(serial: number): MinguoParseResult {
  if (!Number.isFinite(serial) || serial <= 0 || serial > 2958465) {
    return { ok: false, reason: "Excel 日期序號超出合理範圍" };
  }
  const days = Math.floor(serial);
  // 1899-12-30 為基準（已內含 Excel 1900 閏年錯誤的修正）
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return { ok: false, reason: "Excel 日期序號無效" };
  return {
    ok: true,
    date: d,
    minguoYear: adToMinguo(d.getUTCFullYear()),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

/**
 * Date → 民國顯示格式「114/07/21」（指令二：統一顯示格式）。
 * null / Invalid Date → 空字串（畫面顯示空白，不顯示 "Invalid Date"）。
 */
export function formatMinguoDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const minguo = adToMinguo(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${minguo}/${m}/${day}`;
}

/** Date → 「民國114年7月21日」（給列印前的中間格式，國字化由 printChinese 處理）。 */
export function formatMinguoDateLong(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const minguo = adToMinguo(d.getUTCFullYear());
  return `民國${minguo}年${d.getUTCMonth() + 1}月${d.getUTCDate()}日`;
}

/**
 * 西元 ISO 日期字串（yyyy-MM-dd，devoteeProfile 等 API 對外輸出的國曆格式）
 * → 民國長格式「民國61年8月15日」。
 *
 * ── 為什麼獨立一支 ────────────────────────────────────────
 * 信眾詳情頁的「國曆生日」欄位收到的是 API 已格式化好的 ISO 字串
 * （src/lib/devoteeProfile.ts 的 solarBirthDate: toISOString().slice(0,10)），
 * 不是 Date 物件。過去畫面直接把這個字串印出來，就會看到「1972-08-15」。
 * 這支把「ISO 字串 → 民國顯示」收斂成唯一一處，畫面不得再各自用 slice／
 * toLocaleDateString 轉換（V13.4 驗收指令）。
 *
 * ⚠️ 這只負責「畫面顯示」。列印流程一律走農曆生日與活動年度歲數
 * （src/lib/activityPrintProfile.ts），與這支完全無關、不得混用。
 *
 * 空字串／null／格式不符 → 回空字串（畫面留白，絕不顯示 Invalid Date）。
 */
export function formatIsoDateToMinguoLong(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso).trim());
  if (!m) return "";
  const built = buildUtcDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return formatMinguoDateLong(built);
}

/** 農曆月份國字（索引 0＝正月）。 */
const LUNAR_MONTH_NAMES = [
  "正月", "二月", "三月", "四月", "五月", "六月",
  "七月", "八月", "九月", "十月", "十一月", "十二月",
] as const;

/** 農曆日期國字（索引 0＝初一）。 */
const LUNAR_DAY_NAMES = [
  "初一", "初二", "初三", "初四", "初五", "初六", "初七", "初八", "初九", "初十",
  "十一", "十二", "十三", "十四", "十五", "十六", "十七", "十八", "十九", "二十",
  "廿一", "廿二", "廿三", "廿四", "廿五", "廿六", "廿七", "廿八", "廿九", "三十",
] as const;

/**
 * 農曆生日 → 民國長格式「民國61年七月初七」（閏月為「民國61年閏七月初七」）。
 *
 * ── 為什麼與國曆共用同一個模組 ─────────────────────────────
 * 驗收規則：國曆與農曆只是曆法不同，畫面上「年份一律用民國」。所以農曆顯示
 * 也在這支唯一的共用模組完成，畫面不得各自拼字串。
 *
 * 傳入的 `year` 是資料庫儲存的**農曆西元年**（例如 1972，與
 * src/lib/lunar.ts 的 lunar.year 同一套），這裡 −1911 換成民國年。
 *
 * ⚠️ 這只負責「畫面顯示」。列印一律走農曆生日與活動年度虛歲
 * （src/lib/activityPrintProfile.ts），與這支無關、不得混用。
 *
 * 規則（指令三）：年、月、日任一缺失或不合法 → 回空字串（畫面留白），
 * 絕不顯示「西元1972…」「1972-…」「只有月日沒有年份」或「Invalid Date」。
 */
export function formatLunarDateToMinguoLong(input: {
  year: number | null | undefined;
  month: number | null | undefined;
  day: number | null | undefined;
  isLeapMonth?: boolean | null;
}): string {
  const { year, month, day, isLeapMonth } = input;
  if (year === null || year === undefined || !Number.isInteger(year)) return "";
  if (month === null || month === undefined || !Number.isInteger(month) || month < 1 || month > 12) return "";
  if (day === null || day === undefined || !Number.isInteger(day) || day < 1 || day > 30) return "";

  const minguo = adToMinguo(year);
  const leapTag = isLeapMonth ? "閏" : "";
  return `民國${minguo}年${leapTag}${LUNAR_MONTH_NAMES[month - 1]}${LUNAR_DAY_NAMES[day - 1]}`;
}

/** Date → 西元 yyyy-MM-dd（給 <input type="date"> 與 API 傳輸用）。 */
export function toIsoDateString(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ============================================================
// V14.1（十八）：全系統統一的民國／農曆日期顯示工具。
// 所有畫面一律呼叫這裡，不得自行 getFullYear()／toLocaleDateString()／
// 直接輸出 ISO。日常操作畫面不顯示西元年份（西元只用於儲存與運算）。
// ============================================================

/** Date → 「民國49年09月25日」（月日補零；日常畫面國曆顯示）。 */
export function formatRocDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const minguo = adToMinguo(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `民國${minguo}年${m}月${day}日`;
}

/** Date → 「民國49/09/25」（窄版）。 */
export function formatRocDateCompact(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const minguo = adToMinguo(d.getUTCFullYear());
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `民國${minguo}/${m}/${day}`;
}

/** 西元 ISO 字串 → 「民國49/09/25」（窄版；空白/無效回空字串）。 */
export function formatIsoDateToRocCompact(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso).trim());
  if (!m) return "";
  const built = buildUtcDate(Number(m[1]), Number(m[2]), Number(m[3]));
  return formatRocDateCompact(built);
}

/**
 * 農曆生日 → 「民國49年閏四月初五」（positional 版，供既有元件直接帶入
 * 已存的農曆年月日與閏月旗標）。內部沿用 formatLunarDateToMinguoLong，
 * 閏月正確、空白/無效回空字串、絕不 Invalid Date。
 *
 * ⚠️ lunarYear 為資料庫儲存的**農曆西元年**（例如 1960），內部 −1911。
 */
export function formatLunarBirthDate(
  lunarYear: number | null | undefined,
  lunarMonth: number | null | undefined,
  lunarDay: number | null | undefined,
  isLeapMonth?: boolean | null
): string {
  return formatLunarDateToMinguoLong({
    year: lunarYear,
    month: lunarMonth,
    day: lunarDay,
    isLeapMonth: isLeapMonth ?? false,
  });
}
