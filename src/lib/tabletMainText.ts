/**
 * V27.11 / V33.1：牌位主文（中軸主標）**全系統共用** formatter。純函式，client/server 皆可用。
 *
 * 目的：跨家戶列印、家戶列印、預覽、PDF、補印、名單一律用**同一個**結果，避免同一牌位出現兩種主文。
 * 只負責名稱格式，不涉版型/查詢/列印紀錄。
 *
 * V33.1：改為呼叫共用的 `resolveRitualDisplayName`（type 只依欄位、防重後綴、歷代祖先用「姓」不用「府」、
 * 乙位正魂自動補「乙位正魂」）。禁止各頁自行 name + 後綴。
 */

import { resolveRitualDisplayName, formatAncestorDisplayName } from "@/lib/ritualDisplayName";

/** 歷代祖先主文：核心（姓）＋歷代祖先（防重）。相容舊「王姓歷代祖先」「王府歷代祖先(舊)」等輸入。 */
export function composeAncestorMainText(displayName: string): string {
  return formatAncestorDisplayName(displayName);
}

/**
 * 依 documentType／category 取得牌位主文。type 只依欄位（category），不猜名稱。
 * ANCESTOR_LINE→王姓歷代祖先、INDIVIDUAL_SOUL→陳永育乙位正魂、DEBT_CREDITOR→累世冤親債主、其餘原樣。
 */
export function formatTabletMainText(category: string, displayName: string): string {
  return resolveRitualDisplayName(category, displayName);
}
