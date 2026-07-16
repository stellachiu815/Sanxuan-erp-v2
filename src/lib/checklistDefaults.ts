import type { ActivityType } from "@prisma/client";

/**
 * 每一種活動類型的預設待辦清單（需求「十一、活動Checklist」）。刻意獨立
 * 成一個不 import Prisma Client 執行期、只用型別的檔案（ActivityType 只
 * 拿來當字面量聯集使用，不需要真正連線資料庫），方便在沙盒環境裡直接跑
 * 自動測試。src/lib/templeEvents.ts 的 seedChecklist() 呼叫這支決定要
 * 建立哪些預設項目。
 */
export function defaultChecklistLabels(activityType: ActivityType): string[] {
  if (activityType === "PURIFICATION") {
    return ["匯入或輸入報名資料", "確認新增信眾資料", "收款完成", "列印小人頭貼紙", "財務對帳", "活動結案"];
  }
  if (activityType === "UNIVERSAL_SALVATION") {
    return [
      "匯入或輸入報名資料",
      "確認新增信眾資料",
      "確認歷代祖先／個人乙位正魂／冤親債主／無緣子女登記",
      "列印祖先／冤親／寶袋／疏文／功德名錄",
      // V9.1「附加列印項目與多寶袋管理機制」新增三項（需求「十五」）
      "確認額外寶袋資料",
      "列印預設寶袋",
      "列印額外寶袋",
      "收款完成",
      "財務對帳",
      "活動結案",
    ];
  }
  // V10.1「供品認捐中心」新增：宮慶／四位主祀神明聖誕，供品認捐相關待辦
  // 項目。這幾種活動類型不一定每次都會設定供品（供品是活動精靈建立後，
  // 另外從「供品認捐中心」加入的選用設定），所以這裡的待辦項目用「確認」
  // 「處理」這種通用措辭，不管有沒有設定供品都適用，不會顯示成好像每次
  // 都一定要有供品資料才能打勾。
  if (
    activityType === "TEMPLE_CELEBRATION" ||
    activityType === "GUANDI_BIRTHDAY" ||
    activityType === "XUANTIAN_BIRTHDAY" ||
    activityType === "YAOCHI_BIRTHDAY" ||
    activityType === "ZHONGTAN_BIRTHDAY"
  ) {
    return [
      "匯入或確認參加名單",
      "確認供品認捐設定（壽龜/麵塔/花果供品等）",
      "登錄爐主與副爐主",
      "收款完成",
      "處理未收款與跨年度未收款",
      "財務對帳",
      "活動結案",
    ];
  }

  return ["匯入或確認參加名單", "收款完成", "列印相關資料", "財務對帳", "活動結案"];
}
