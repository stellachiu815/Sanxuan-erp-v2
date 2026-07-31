/**
 * V27.11：牌位主文（中軸主標）**全系統共用** formatter。純函式，client/server 皆可用。
 *
 * 目的：跨家戶列印、家戶列印、預覽、PDF、補印一律用**同一個**結果，避免同一牌位在不同
 * 列印入口出現兩種主文。**只**負責名稱格式，不涉版型、資料查詢、列印紀錄。
 *
 * 規則（依宮方正式格式）：
 *   - 歷代祖先（ANCESTOR_LINE）：主標＝「姓氏＋府＋歷代祖先」（如「蔡府歷代祖先」「歐陽府歷代祖先」）。
 *     由既有 displayName 內的姓氏組成，並修正舊資料的「○姓歷代祖先」與被截斷的「○姓」。
 *   - 其餘類型（乙位正魂／無緣子女／冤親債主）：不變（維持原 displayName / 既有正名邏輯）。
 */

/** 歷代祖先主文：姓氏＋府＋歷代祖先。 */
export function composeAncestorMainText(displayName: string): string {
  const raw = (displayName ?? "").trim();
  if (!raw) return raw;
  // 取姓氏：去尾端「歷代祖先」與其後綴「姓／府」，其餘即姓氏（支援複姓，如歐陽／司馬）。
  const surname = raw.replace(/歷代祖先$/, "").replace(/[姓府]$/, "").trim();
  if (!surname) return raw; // 取不到姓氏 → 不破壞原資料。
  return `${surname}府歷代祖先`;
}

/**
 * 依 documentType／category 取得牌位主文。目前只調整歷代祖先；其餘原樣回傳。
 * category 接受 UniversalSalvationEntryCategory 字串（ANCESTOR_LINE 等）。
 */
export function formatTabletMainText(category: string, displayName: string): string {
  if (category === "ANCESTOR_LINE") return composeAncestorMainText(displayName);
  return displayName;
}
