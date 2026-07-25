/**
 * V15R4：累世冤親債主「正名」純函式（不 import Prisma，可 tsx 直接測）。
 *
 * 需求：輸入辨識相容「冤親債主／歷世冤親債主／累世冤親債主」（含舊資料錯字「歷世」），
 * 但所有畫面、列印、正式輸出一律顯示「累世冤親債主」。
 *
 * 用途：顯示／列印時把舊資料或簡寫的牌位顯示名正規化。**只**改變恰為這幾種變體
 * 的字串（或以其開頭再接編號，如「冤親債主（3）」），其他姓名/名稱一律原樣返回，
 * 不會誤改任何真實姓名。
 */
export const DEBT_CREDITOR_CANONICAL = "累世冤親債主";

/** 會被正規化為「累世冤親債主」的既有變體（去空白後比對）。 */
const DEBT_CREDITOR_VARIANTS = ["累世冤親債主", "歷世冤親債主", "冤親債主", "歷世冤親", "冤親"];

/**
 * 顯示／列印用：把冤親債主各種既有寫法統一為「累世冤親債主」。
 * 支援帶編號的批次牌位名（例如「冤親債主（3）」→「累世冤親債主（3）」）。
 * 非冤親變體 → 原樣返回。
 */
export function displayDebtCreditorName(raw: string | null | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return s;
  const compact = s.replace(/\s+/g, "");
  // 純變體（可含全形／半形括號編號後綴）。
  for (const v of DEBT_CREDITOR_VARIANTS) {
    if (compact === v) return DEBT_CREDITOR_CANONICAL;
    // 帶編號：變體 +（n）/(n)/ n 等後綴。
    const m = compact.match(new RegExp(`^${v}[（(]?\\s*(\\d+)\\s*[）)]?$`));
    if (m) return `${DEBT_CREDITOR_CANONICAL}（${m[1]}）`;
  }
  return s;
}
