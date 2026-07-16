/**
 * 中文國字數字轉換工具（V9.0「祭改管理與小人頭貼紙列印」新增）。
 *
 * 這個檔案刻意設計成「純函式、不 import 任何其他模組」——不依賴 Prisma、
 * 不依賴 lunar-javascript，方便在這個沙盒環境裡直接用 `tsx --test` 執行
 * 真正的自動測試（見 tests/chineseNumerals.test.ts），不用等到能夠
 * `npm install` 之後才能驗證這裡面最容易出錯的邏輯。
 *
 * ⚠️ 三玄宮宮務列印規則明確要求「兩種不同的中文數字讀法」，不可以共用
 * 同一套轉換邏輯，這是這個檔案存在的核心理由：
 *
 * 1. 【數值讀法】（toChineseNumeral）：歲數、月份、日期使用——
 *    54 → 五十四、25 → 二十五、12 → 十二、3 → 三。
 *    這是正常「這是多少」的中文數字讀法，十位數/百位數會做進位組字。
 *
 * 2. 【逐字讀法】（digitsToChineseDigits / convertAddressToChineseNumerals）：
 *    地址門牌號碼使用——181 → 一八一（不是"一百八十一"），
 *    這是把每一個阿拉伯數字字元逐一換成對應的中文數字字元，跟電話號碼、
 *    身分證字號的唸法一樣，不做進位組字。
 *
 * 兩者絕對不能搞混：地址門牌如果誤用【數值讀法】會變成「一百八十一號」，
 * 跟現有慣例（逐字唸）不符；歲數如果誤用【逐字讀法】會變成「五四歲」，
 * 讀起來就不是「五十四歲」了。
 */

const CHINESE_DIGIT_CHARS = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

/** 0-999 的中文數字組字（內部使用）。topLevel=false 代表這段數字是接在更高位數
 *  之後（例如百位數後面的十位數），此時「一十」的「一」不可省略；topLevel=true
 *  則是這段數字本身就是完整答案時，10-19 之間才可以省略開頭的「一」
 *  （例如單獨的 15 唸「十五」，但接在百位數後面的 115 要唸「一百一十五」，
 *  不能唸成「一百十五」）。 */
function belowThousandToChinese(n: number, topLevel: boolean): string {
  if (n < 10) return CHINESE_DIGIT_CHARS[n];
  if (n < 20) {
    const prefix = topLevel ? "" : CHINESE_DIGIT_CHARS[1];
    const ones = n === 10 ? "" : CHINESE_DIGIT_CHARS[n - 10];
    return `${prefix}十${ones}`;
  }
  if (n < 100) {
    const tens = Math.floor(n / 10);
    const ones = n % 10;
    return `${CHINESE_DIGIT_CHARS[tens]}十${ones === 0 ? "" : CHINESE_DIGIT_CHARS[ones]}`;
  }
  const hundreds = Math.floor(n / 100);
  const rem = n % 100;
  const result = `${CHINESE_DIGIT_CHARS[hundreds]}百`;
  if (rem === 0) return result;
  if (rem < 10) return `${result}零${CHINESE_DIGIT_CHARS[rem]}`;
  return result + belowThousandToChinese(rem, false);
}

/**
 * 把非負整數轉成正式中文數字（數值讀法，有進位組字）。
 * 支援 0～9999（歲數/月份/日期實際上不會超過三位數，多支援到四位數只是保守起見）。
 * 輸入負數或非整數會丟出例外——呼叫端應該在那之前就先判斷資料是否合理，
 * 不應該讓這裡「盡量轉換出一個看起來像答案的字串」。
 */
export function toChineseNumeral(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`toChineseNumeral: 只接受非負整數，收到 ${n}`);
  }
  if (n === 0) return "〇";
  if (n < 1000) return belowThousandToChinese(n, true);
  if (n > 9999) {
    throw new Error(`toChineseNumeral: 超出支援範圍（0～9999），收到 ${n}`);
  }
  const thousands = Math.floor(n / 1000);
  const rem = n % 1000;
  const result = `${CHINESE_DIGIT_CHARS[thousands]}千`;
  if (rem === 0) return result;
  if (rem < 100) return `${result}零${belowThousandToChinese(rem, false)}`;
  return result + belowThousandToChinese(rem, false);
}

/**
 * 把字串裡的每一個阿拉伯數字字元，逐一換成對應的中文數字字元（逐字讀法，
 * 不做進位組字）。非數字字元（中文字、「號」「樓」「之」「段」等）完全不動。
 *
 * 這是地址門牌轉換的核心邏輯：「承德路4段181號7樓之1」
 * → 「承德路四段一八一號七樓之一」。
 */
export function digitsToChineseDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => CHINESE_DIGIT_CHARS[Number(d)]);
}

/** 地址專用的別名（語意更清楚），行為與 digitsToChineseDigits 完全相同。 */
export function convertAddressToChineseNumerals(address: string): string {
  return digitsToChineseDigits(address);
}

/** 歲數格式化：例如 54 → 「五十四歲」。 */
export function formatChineseAge(age: number): string {
  return `${toChineseNumeral(age)}歲`;
}

export type FormalLunarDateText = {
  monthText: string; // 例如「七月」「十二月」「閏四月」
  dayText: string; // 例如「七日」「二十五日」「三日」
  combined: string; // monthText + dayText
};

/**
 * 正式宮務列印用的農曆日期格式（數值讀法，不用「初七」「廿五」這種
 * 民間慣用簡稱）。例如：
 * - (7, 7, false)  → 月「七月」日「七日」（不可變成「七月初七」）
 * - (2, 25, false) → 月「二月」日「二十五日」（不可變成「二月廿五」）
 * - (12, 3, false) → 月「十二月」日「三日」（不可變成「十二月初三」）
 */
export function formatFormalLunarDate(
  month: number,
  day: number,
  isLeapMonth = false
): FormalLunarDateText {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`formatFormalLunarDate: 月份不合法（${month}）`);
  }
  if (!Number.isInteger(day) || day < 1 || day > 30) {
    throw new Error(`formatFormalLunarDate: 日期不合法（${day}）`);
  }
  const leapPrefix = isLeapMonth ? "閏" : "";
  const monthText = `${leapPrefix}${toChineseNumeral(month)}月`;
  const dayText = `${toChineseNumeral(day)}日`;
  return { monthText, dayText, combined: monthText + dayText };
}

export type NormalizedGender = "MALE" | "FEMALE" | "UNKNOWN";

/** 把系統裡自由文字的性別欄位（"男"/"女"/null/其他）正規化成三態。 */
export function normalizeGender(raw: string | null | undefined): NormalizedGender {
  if (raw === "男") return "MALE";
  if (raw === "女") return "FEMALE";
  return "UNKNOWN";
}

/**
 * 依性別回傳「吉時建生」／「吉時瑞生」。性別未填寫（UNKNOWN）時回傳 null，
 * 呼叫端必須把這種情況列入「待確認清單」，不可以自行猜測要顯示哪一種
 * （這是需求明確禁止的行為）。
 */
export function formatJishi(gender: NormalizedGender): string | null {
  if (gender === "MALE") return "吉時建生";
  if (gender === "FEMALE") return "吉時瑞生";
  return null;
}
