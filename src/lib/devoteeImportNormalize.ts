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
 * 拆解「家戶成員」／「歷代祖先」／「乙位正魂」這類多筆姓名的欄位。
 *
 * 支援的分隔符（V12.6 指令二：逗號、頓號、換行）：
 *   、  ，  ,   以及換行（\n、\r\n）與分號 ;／；
 *
 * 換行是這一版新增的——Excel 儲存格內用 Alt+Enter 換行列多位成員是行政
 * 人員常用的寫法，舊版只切逗號會把整格當成一個超長姓名。
 *
 * 拆開後每一筆都會 trim（含全形空白與定位字元），空字串（例如結尾多打了
 * 一個分隔符號、或中間有空行）會被濾掉，不會產生空白姓名。
 */
export function splitMultiValue(raw: unknown): string[] {
  if (raw === null || raw === undefined) return [];
  const s = toHalfWidthDigits(String(raw)).trim();
  if (!s) return [];
  return s
    .split(/[、，,;；\r\n]+/)
    .map((part) => part.replace(/^[\s　\t]+|[\s　\t]+$/g, ""))
    .filter((part) => part.length > 0);
}
