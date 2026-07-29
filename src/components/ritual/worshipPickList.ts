import type { WorshipOptionJSON } from "./types";

/**
 * 「本戶固定牌位」帶入清單的純計算（歷代祖先／乙位正魂共用）。
 *
 * 契約（對應普渡報名「帶入」需求，避免未來回歸）：
 *  1. **逐筆保留**每一個選項——即使某筆已加入草稿，也只把「那一筆」標記為 already，
 *     絕不因為有任何一筆已加入就把整份清單清空或濾掉。
 *  2. already＝該選項的 displayName 已存在於目前草稿項目中（畫面顯示為 ✓、停用，
 *     不重複建立）；其餘 already=false，可點擊帶入。
 *  3. 順序與內容忠實反映傳入的 options（後端已做同名同址去重），本函式不再另行過濾。
 */
export type WorshipPickItem = WorshipOptionJSON & { already: boolean };

export function buildWorshipPickList(
  options: WorshipOptionJSON[],
  draftEntries: { displayName: string }[]
): WorshipPickItem[] {
  const taken = new Set(draftEntries.map((e) => e.displayName));
  return options.map((o) => ({ ...o, already: taken.has(o.displayName) }));
}
