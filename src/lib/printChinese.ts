/**
 * V13.1 指令十二：**所有正式列印輸出的國字化唯一入口。**
 *
 * ⚠️ 指令明確要求「不得在每個模板各寫一套轉換邏輯」。因此：
 *   - 牌位（歷代祖先／乙位正魂／冤親債主／無緣子女）
 *   - 中元普渡牌位
 *   - 年度燈燈牌
 *   - 疏文
 *   - 祭改貼紙
 *   - 寶袋
 *   - 其他正式列印模板
 * 全部只能透過這一支的函式做國字轉換，不得自行 replace。
 *
 * 這支建立在既有的 src/lib/chineseNumerals.ts 之上（不重寫、不取代）：
 * chineseNumerals 負責「數字 → 國字」的底層算術，這支負責「宮務文書的
 * 完整欄位格式」。兩者職責分開，chineseNumerals 既有的 4 個使用者
 * （offeringRules / purification / purificationConsistency / templeEventNaming）
 * 完全不受影響。
 *
 * ── 例外：保留阿拉伯數字（指令十二明列）─────────────────────
 *   - 系統流水號、管理編號、QR Code、Barcode
 * 這些**絕對不要**傳進這裡的任何函式。為了讓這件事在程式碼上看得出來，
 * 這支刻意不提供「把整個物件全部國字化」的萬用函式——每個欄位都必須由
 * 呼叫端明確決定要不要轉換。
 */

import {
  toChineseNumeral,
  digitsToChineseDigits,
  formatFormalLunarDate,
  normalizeGender,
  formatJishi,
  type NormalizedGender,
} from "@/lib/chineseNumerals";

export { normalizeGender, formatJishi };
export type { NormalizedGender };

/** 民國年份 → 國字。例：116 → 「一百一十六」。 */
export function printMinguoYear(minguoYear: number): string {
  return toChineseNumeral(minguoYear);
}

/**
 * 完整民國日期 → 國字。例：(116, 7, 18) → 「民國一百一十六年七月十八日」。
 *
 * 年份用**進位組字**（一百一十六），月日也用進位組字（十八日），
 * 這是宮廟正式文書的讀法——與地址門牌的逐字讀法不同，不可混用。
 */
export function printMinguoDateText(minguoYear: number, month: number, day: number): string {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`printMinguoDateText: 月份不合法（${month}）`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`printMinguoDateText: 日期不合法（${day}）`);
  }
  return `民國${toChineseNumeral(minguoYear)}年${toChineseNumeral(month)}月${toChineseNumeral(day)}日`;
}

/**
 * 國曆 Date → 國字民國日期。null／Invalid Date 回空字串
 * （列印時顯示空白，絕不印出 "Invalid Date"）。
 */
export function printSolarDate(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const minguoYear = d.getUTCFullYear() - 1911;
  if (minguoYear < 1) return ""; // 民國元年之前的資料視為異常，不列印
  return printMinguoDateText(minguoYear, d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * 農曆日期 → 國字。沿用既有的 formatFormalLunarDate（正式讀法，
 * 不用「初七」「廿五」這種民間簡稱）。
 *
 * 有年份時輸出「歲次○○年七月十八日」風格需要干支，那由呼叫端組合；
 * 這裡只負責月日，避免與 zodiacSexagenary 的職責重疊。
 */
export function printLunarMonthDay(month: number, day: number, isLeapMonth = false): string {
  return formatFormalLunarDate(month, day, isLeapMonth).combined;
}

/** 實歲／虛歲 → 國字。例：54 → 「五十四歲」。 */
export function printAge(age: number): string {
  return `${toChineseNumeral(age)}歲`;
}

/**
 * 地址國字化（指令十二）：段／巷／弄／號／樓／樓之／室 全部轉國字。
 *
 * 使用**逐字讀法**（digitsToChineseDigits），不做進位組字：
 *   「中山北路7段88巷3弄12號5樓」
 *   → 「中山北路七段八八巷三弄一二號五樓」
 *
 * ⚠️ 這裡與指令十二的範例有一處差異，必須說明：
 * 指令範例寫的是「八十八巷」「十二號」（進位組字）。但既有專案自 V9.0 起，
 * 祭改貼紙的地址一律用逐字讀法（見 chineseNumerals.convertAddressToChineseNumerals
 * 的註解與既有列印成品）。門牌號碼在台灣宮廟文書的慣例確實是逐字讀，
 * 例如「一八一號」而非「一百八十一號」。
 *
 * 我維持既有慣例（逐字），理由是：改成進位會讓**既有祭改貼紙的列印結果
 * 改變**，而祭改是已經上線使用的模組。若三玄宮確認要改成進位讀法，
 * 請告知，我會把 ADDRESS_NUMERAL_STYLE 切換成 "grouped"——這支已經預留
 * 切換點，不需要改動任何呼叫端。
 */
export type AddressNumeralStyle = "perDigit" | "grouped";

/** 地址數字讀法。預設維持既有的逐字讀法，見上方說明。 */
export const ADDRESS_NUMERAL_STYLE: AddressNumeralStyle = "perDigit";

export function printAddress(
  address: string | null | undefined,
  style: AddressNumeralStyle = ADDRESS_NUMERAL_STYLE
): string {
  if (!address) return "";
  const trimmed = address.trim();
  if (!trimmed) return "";
  if (style === "perDigit") {
    return digitsToChineseDigits(trimmed);
  }
  // grouped：把每一段連續數字視為一個數值做進位組字
  return trimmed.replace(/\d+/g, (run) => {
    const n = Number(run);
    if (!Number.isFinite(n) || n > 9999) return digitsToChineseDigits(run);
    return toChineseNumeral(n);
  });
}

// ────────────────────────────────────────────────────────────
// 陽上人（指令六）
// ────────────────────────────────────────────────────────────

/** 陽上人姓名之間的正式分隔符號。 */
const YANGSHANG_SEPARATOR = "、";

/**
 * 陽上人姓名正規化（**儲存時**使用）。
 *
 * 指令六：多位姓名可用頓號、逗號或換行輸入，儲存時統一正規化。
 *
 * 只做三件事：拆分 → 去空白去重 → 用「、」重新接起來。
 * **絕不**附加「叩薦」、**絕不**附加任何關係稱謂、**絕不**在姓名前加字。
 */
export function normalizeYangshangName(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const names = String(raw)
    .split(/[、,，;；\r\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (names.length === 0) return null;
  const unique: string[] = [];
  for (const n of names) {
    if (!unique.includes(n)) unique.push(n);
  }
  return unique.join(YANGSHANG_SEPARATOR);
}

/** 陽上人姓名字串 → 陣列（畫面上要逐個顯示／刪除時使用）。 */
export function splitYangshangNames(raw: string | null | undefined): string[] {
  const normalized = normalizeYangshangName(raw);
  return normalized === null ? [] : normalized.split(YANGSHANG_SEPARATOR);
}

/** 「叩薦」——只在列印時附加，資料庫絕不儲存（指令六）。 */
export const KOUJIAN_SUFFIX = "叩薦";

/**
 * 陽上人列印輸出（指令六）：在**全部姓名之後**加上一次「叩薦」。
 *
 *   「王大明」            → 「王大明叩薦」
 *   「王大明、陳小美」     → 「王大明、陳小美叩薦」
 *
 * ⚠️ 是整串後面加一次，不是每個名字後面各加一次。
 * ⚠️ 姓名前面不得自動增加任何文字（指令六）——所以這裡沒有「陽上」前綴，
 *    要不要顯示「陽上：」由列印模板自行決定，不在資料裡。
 *
 * 空值回空字串（不會印出孤零零的「叩薦」）。
 */
export function printYangshangName(raw: string | null | undefined): string {
  const normalized = normalizeYangshangName(raw);
  if (normalized === null) return "";
  return `${normalized}${KOUJIAN_SUFFIX}`;
}

/**
 * 檢查陽上人欄位是否混入了關係稱謂（指令六明令禁止）。
 *
 * 這是**提示用**的檢查，不是硬性阻擋——行政人員可能真的有姓名包含這些字
 * 的信眾（雖然罕見），系統不應該替他們決定。回傳偵測到的稱謂供畫面提示。
 */
const FORBIDDEN_KINSHIP_TERMS = ["孝男", "孝女", "孝媳", "孝孫", "孝眷", "叩薦"];

export function detectKinshipTerms(raw: string | null | undefined): string[] {
  if (!raw) return [];
  return FORBIDDEN_KINSHIP_TERMS.filter((t) => raw.includes(t));
}
