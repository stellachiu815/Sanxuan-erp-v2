/**
 * V13.1 指令一：身分證字號的正規化、驗證與遮罩。
 *
 * 純函式、零相依。
 *
 * ── 核心原則（指令一逐條對應）─────────────────────────────
 * 1. 可空白 —— 空白不是錯誤，回傳 null。
 * 2. **只有輸入時才驗證格式** —— 這點很重要：既有正式資料裡可能有格式
 *    不正確的舊資料，驗證只在「使用者這次實際輸入了值」時執行，不會回頭
 *    把既有資料判定為錯誤而讓整筆資料存不進去。
 * 3. Excel 空白不得覆蓋既有資料 —— 這是呼叫端的責任（見匯入流程的
 *    keepIfBlank 慣例），這支只負責「空白 → null」。
 * 4. 名單頁遮罩、詳情頁依權限顯示完整內容 —— maskNationalId() 提供遮罩。
 */

/** 內政部規定的縣市英文字母對應碼（A=10, B=11, ... 依官方順序，非字母序）。 */
const LETTER_CODES: Record<string, number> = {
  A: 10, B: 11, C: 12, D: 13, E: 14, F: 15, G: 16, H: 17, I: 34, J: 18,
  K: 19, L: 20, M: 21, N: 22, O: 35, P: 23, Q: 24, R: 25, S: 26, T: 27,
  U: 28, V: 29, W: 32, X: 30, Y: 31, Z: 33,
};

/**
 * 正規化：去除空白與連字號、轉大寫。空字串一律回 null。
 *
 * ⚠️ 這支**不驗證格式**——正規化與驗證刻意分開，因為既有資料需要能被
 * 正規化後儲存/比對，即使它的格式不合法。
 */
export function normalizeNationalId(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).replace(/[\s\-－—]/g, "").toUpperCase();
  return s === "" ? null : s;
}

export type NationalIdValidation =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * 驗證中華民國身分證字號（1 英文字母 + 9 位數字，含檢核碼）。
 *
 * 同時接受新式外來人口統一證號（第 2 碼為 A～D 的英文字母，2021 年新制），
 * 因為宮廟信眾確實可能有外籍配偶。
 *
 * null / 空白 → { ok: true }（可空白，見指令一）。
 */
export function validateNationalId(value: string | null | undefined): NationalIdValidation {
  const id = normalizeNationalId(value);
  if (id === null) return { ok: true }; // 可空白

  if (id.length !== 10) {
    return { ok: false, reason: "身分證字號必須是 10 碼（1 個英文字母 + 9 位數字）" };
  }

  const first = id[0];
  if (!(first in LETTER_CODES)) {
    return { ok: false, reason: "身分證字號第 1 碼必須是英文字母" };
  }

  // 第 2 碼：本國籍為 1（男）或 2（女）；2021 新式外來人口統一證號為 A～D。
  const second = id[1];
  let secondDigit: number;
  if (second === "1" || second === "2") {
    secondDigit = Number(second);
  } else if (second >= "A" && second <= "D") {
    // 新式統一證號：第 2 碼字母取其代碼的個位數
    secondDigit = LETTER_CODES[second] % 10;
  } else {
    return { ok: false, reason: "身分證字號第 2 碼必須是 1、2（本國籍）或 A～D（外來人口）" };
  }

  if (!/^\d{8}$/.test(id.slice(2))) {
    return { ok: false, reason: "身分證字號第 3～10 碼必須是數字" };
  }

  // 檢核碼計算（內政部公式）
  const letterCode = LETTER_CODES[first];
  let sum = Math.floor(letterCode / 10) + (letterCode % 10) * 9;
  sum += secondDigit * 8;
  for (let i = 2; i <= 8; i++) {
    sum += Number(id[i]) * (9 - i);
  }
  sum += Number(id[9]);

  if (sum % 10 !== 0) {
    return { ok: false, reason: "身分證字號檢核碼不正確，請確認是否輸入錯誤" };
  }
  return { ok: true };
}

/**
 * 名單頁遮罩顯示（指令一）：A123456789 → A12****789。
 *
 * 保留頭 3 碼與尾 3 碼——足以讓行政人員在名單上辨識是哪一位，
 * 又不會在螢幕上完整曝露個資。
 *
 * 長度不足 10 碼的異常資料一律整串遮成 ****，不做部分曝露。
 */
export function maskNationalId(value: string | null | undefined): string {
  const id = normalizeNationalId(value);
  if (id === null) return "";
  if (id.length !== 10) return "****";
  return `${id.slice(0, 3)}****${id.slice(7)}`;
}
