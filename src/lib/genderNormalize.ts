/**
 * V13.2：性別的**唯一**正規化來源。
 *
 * 純函式、零相依，可直接用 node 測試。
 *
 * ── 這支與既有 chineseNumerals.normalizeGender() 的分工 ──────────
 * 兩者職責不同，不是重複實作：
 *
 *   chineseNumerals.normalizeGender()  「男」/「女」→ MALE/FEMALE/UNKNOWN
 *                                       用途：列印時決定建生／瑞生
 *                                       輸入來源：**資料庫**（已正規化的值）
 *
 *   genderNormalize.normalizeGenderInput()（本檔）
 *                                       「男性」/「M」/「female」→ 「男」/「女」/null
 *                                       用途：Excel 匯入與表單輸入的正規化
 *                                       輸入來源：**外部**（未正規化的值）
 *
 * 也就是說：外部資料先經過這一支變成「男」/「女」，存進資料庫；
 * 列印時再由 chineseNumerals 那一支轉成 MALE/FEMALE。
 * 資料庫裡永遠只會有「男」、「女」或 null 三種值。
 *
 * ── 絕對禁止的事（V13.2 明令）──────────────────────────────
 * ⚠️ **不得從身分證字號推導性別。**
 * 中華民國身分證第 2 碼確實編碼了性別（1=男、2=女），技術上做得到，
 * 但 V13.2 明確禁止。理由是資料正確性：身分證可能打錯、可能是外來人口
 * 統一證號（第 2 碼是 A～D）、也可能與當事人現況不符。性別的唯一來源
 * 是個人資料工作表的「性別」欄位。
 *
 * 為了讓這件事在程式碼層面看得見，這整支檔案不接受任何身分證參數，
 * 也沒有 import 任何身分證相關模組。
 */

/** 資料庫中允許的性別值。 */
export type StoredGender = "男" | "女";

/** 合法的性別選項（供下拉選單使用）。 */
export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "未填寫" },
  { value: "男", label: "男" },
  { value: "女", label: "女" },
];

/**
 * 各種可能的輸入寫法 → 標準值。
 *
 * 涵蓋個人資料工作表實務上會出現的格式。全部以**小寫、去空白**後比對，
 * 所以 "m" / "M" / " M " 都會命中同一筆。
 */
const GENDER_ALIASES: Record<string, StoredGender> = {
  // 中文
  "男": "男",
  "女": "女",
  "男性": "男",
  "女性": "女",
  "男生": "男",
  "女生": "女",
  "男士": "男",
  "女士": "女",
  // 英文縮寫與全稱
  "m": "男",
  "f": "女",
  "male": "男",
  "female": "女",
  // 數字代碼（部分舊系統匯出會用）
  "1": "男",
  "2": "女",
};

export type GenderNormalizeResult =
  | { ok: true; value: StoredGender }
  /** 空白：合法，代表「未填寫」。不是錯誤 */
  | { ok: true; value: null }
  /**
   * 無法辨識：**不猜測**。呼叫端必須把這一筆列入人工確認清單
   * （V13.2 第二節：「不可擅自猜測」「不可寫入其他任意文字」）。
   */
  | { ok: false; raw: string; reason: string };

/**
 * 正規化外部來源（Excel／表單）的性別值。
 *
 * @param raw 原始值。null／undefined／空字串一律視為「未填寫」。
 */
export function normalizeGenderInput(raw: unknown): GenderNormalizeResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  // 全形英數 → 半形（Excel 常見）
  const half = String(raw).replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
    String.fromCharCode(c.charCodeAt(0) - 0xfee0)
  );
  const trimmed = half.trim();
  if (trimmed === "") return { ok: true, value: null };

  const hit = GENDER_ALIASES[trimmed.toLowerCase()];
  if (hit) return { ok: true, value: hit };

  return {
    ok: false,
    raw: trimmed,
    reason: `性別「${trimmed}」無法辨識，請人工確認（可接受：男、女、男性、女性、M、F）`,
  };
}

/**
 * 便利版：只要值，無法辨識時回 null。
 *
 * ⚠️ 只有在呼叫端**已經另外處理過人工確認**時才可以用這個版本。
 * 匯入流程請用 normalizeGenderInput() 並處理 ok:false 的情況，
 * 否則無法辨識的性別會被靜默丟掉，使用者不會知道。
 */
export function toStoredGender(raw: unknown): StoredGender | null {
  const r = normalizeGenderInput(raw);
  return r.ok ? r.value : null;
}

/**
 * 驗證要寫入資料庫的性別值是否合法。
 *
 * 用於表單／API 的最後一道防線：確保資料庫裡不會出現「男性」「M」
 * 這類未正規化的值，也不會出現任何自由文字（V13.2 第五節：
 * 「不可自由輸入其他文字」）。
 */
export function isValidStoredGender(value: unknown): value is StoredGender | null {
  return value === null || value === "男" || value === "女";
}

/**
 * 兩個性別值是否衝突（V13.2 第三節）。
 *
 * 只有「兩邊都有值且不相同」才算衝突。任一邊為 null 都不是衝突——
 * 空白代表「沒有這項資料」，不代表「與對方不同」。
 */
export function isGenderConflict(
  existing: string | null | undefined,
  incoming: string | null | undefined
): boolean {
  if (!existing || !incoming) return false;
  return existing !== incoming;
}
