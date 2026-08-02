/**
 * V30.4 純函式規則（client-safe，不 import Prisma，便於單元測試）。
 * 供「列印管理下拉來源」與「確認報名是否需補確認 DRAFT」兩處共用同一份判斷邏輯。
 */

export type ActivityItemSummaryLite = {
  itemKey: string;
  itemName: string;
  activityGroup: string;
};

export type DropdownOption = { key: string; name: string };

/**
 * 列印管理「報名項目」下拉來源：以**該中元普渡活動已啟用的 RegistrationItemType**（summary）為準，
 * 不依目前查到的名單結果動態產生——因此某項目 0 筆也**保留可選**（選取後名單查詢仍走正式 CONFIRMED 條件）。
 *   - 只取 activityGroup = UNIVERSAL_SALVATION 的項目。
 *   - 顯示**正式名稱** itemName（不新舊名稱混用）。
 *   - 維持 summary 既有排序（呼叫端已依 activityGroup, sortOrder 排好）。
 *   - 最前面加「全部項目」（key=""）。
 */
export function universalSalvationItemDropdown(summary: ActivityItemSummaryLite[]): DropdownOption[] {
  const opts = summary
    .filter((s) => s.activityGroup === "UNIVERSAL_SALVATION")
    .map((s) => ({ key: s.itemKey, name: s.itemName }));
  return [{ key: "", name: "全部項目" }, ...opts];
}

/**
 * 主報名已 CONFIRMED 時，是否仍需要跑一次確認流程以補確認「之後新增、仍停在 DRAFT 的 item」。
 * （確認後再加全戶冤親／再補牌位會落在這裡。）只看**本 record 自己的** DRAFT 數，不跨 record、不全庫批次。
 *   - 已 CONFIRMED 且尚有 DRAFT item → true（要補確認）。
 *   - 已 CONFIRMED 且沒有 DRAFT item → false（等同 no-op）。
 */
export function confirmedRecordHasLeftoverDrafts(recordStatus: string, draftItemCount: number): boolean {
  return recordStatus === "CONFIRMED" && draftItemCount > 0;
}
