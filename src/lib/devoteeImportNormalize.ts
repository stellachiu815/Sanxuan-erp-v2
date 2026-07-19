/**
 * V11.3「信眾資料匯入預檢中心」正式版——資料正規化（依正式 7 欄 Excel 格式，
 * 需求「三玄宮 ERP V11.3 家戶匯入正式版」）。
 *
 * 這個檔案刻意不 import Prisma、不碰資料庫，純函式，方便在沙盒環境裡直接
 * 用簡單的呼叫驗證行為（不需要接資料庫）。所有函式都「不會丟出例外」——
 * 輸入看不懂就回傳空字串／空陣列，不會讓呼叫端因為單一欄位崩潰。
 *
 * ⚠️ 這一版正式格式只有「家戶編號／戶名／主要聯絡人／地址／歷代祖先／
 * 乙位正魂／家戶成員」七個欄位，不再有生日／性別／農曆／生肖／往生標記
 * 等舊版彈性格式欄位，所以舊版對應的正規化函式（日期、性別、生肖同義詞
 * 換算等）已經一併移除，不是遺漏——這些欄位在正式格式裡已經不存在。
 */

/** 姓名／戶名前後空白（含全形空白）。 */
export function normalizeName(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  return String(raw).replace(/^[\s　]+|[\s　]+$/g, "");
}

/** 全形數字轉半形（其餘全形符號不動，避免誤傷地址裡的中文標點）。 */
export function toHalfWidthDigits(raw: string): string {
  return raw.replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
}

/** 一般文字欄位（主要聯絡人／地址等）：只做 trim，空字串轉 null。 */
export function toNullableText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return null;
  const s = toHalfWidthDigits(String(raw)).trim();
  return s.length > 0 ? s : null;
}

/**
 * 拆解「家戶成員」／「歷代祖先」／「乙位正魂」這類逗號分隔多筆姓名的欄位
 * （需求：依「、」或「，」拆開；這裡同時支援半形逗號「,」，避免使用者
 * 直接用英文輸入法打逗號時被擋下）。拆開後每一筆都會 trim（含全形空白），
 * 空字串（例如結尾多打了一個分隔符號）會被濾掉，不會產生空白姓名。
 */
export function splitMultiValue(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return [];
  return s
    .split(/[、，,]/)
    .map((part) => part.replace(/^[\s　]+|[\s　]+$/g, ""))
    .filter((part) => part.length > 0);
}
