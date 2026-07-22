import { listWiredSourceTypes } from "@/lib/receivableAdapters";

export const worshipTypeLabel: Record<string, string> = {
  ANCESTOR_LINE: "歷代祖先",
  INDIVIDUAL: "個人往生者",
};

// 新增祭祀資料表單用的下拉選項（依需求只支援這兩種）
export const worshipTypeOptions: { value: "ANCESTOR_LINE" | "INDIVIDUAL"; label: string }[] = [
  { value: "ANCESTOR_LINE", label: "歷代祖先" },
  { value: "INDIVIDUAL", label: "個人乙位正魂" },
];

export const activityTypeLabel: Record<string, string> = {
  ANNUAL_LANTERN: "年度燈",
  UNIVERSAL_SALVATION: "中元普渡",
  TEMPLE_CELEBRATION: "宮慶",
  REPRINT: "補印",
  // V8.1「宮務活動中心」新增
  PURIFICATION: "祭改",
  GUANGMING_LANTERN: "光明燈",
  TAISUI_LANTERN: "太歲燈",
  FAMILY_LANTERN: "全家燈",
  STORAGE_REPAYMENT: "補庫",
  OTHER: "其他",
  // V10.1「供品認捐中心」新增：四位主祀神明聖誕（各自獨立的 ActivityType，
  // 原因見 schema.prisma ActivityType enum 上方註解）。
  GUANDI_BIRTHDAY: "關聖帝君聖誕",
  XUANTIAN_BIRTHDAY: "玄天上帝聖誕",
  YAOCHI_BIRTHDAY: "瑤池金母聖誕",
  ZHONGTAN_BIRTHDAY: "中壇元帥聖誕",
};

// V8.1「活動精靈」Step1「選擇活動」畫面用的選項順序（依需求規格順序排列）。
export const templeEventActivityTypeOptions: { value: string; label: string }[] = [
  { value: "UNIVERSAL_SALVATION", label: "中元普渡" },
  { value: "GUANGMING_LANTERN", label: "光明燈" },
  { value: "TAISUI_LANTERN", label: "太歲燈" },
  { value: "FAMILY_LANTERN", label: "全家燈" },
  { value: "PURIFICATION", label: "祭改" },
  { value: "STORAGE_REPAYMENT", label: "補庫" },
  { value: "TEMPLE_CELEBRATION", label: "宮慶" },
  // V10.1「供品認捐中心」新增
  { value: "GUANDI_BIRTHDAY", label: "關聖帝君聖誕" },
  { value: "XUANTIAN_BIRTHDAY", label: "玄天上帝聖誕" },
  { value: "YAOCHI_BIRTHDAY", label: "瑤池金母聖誕" },
  { value: "ZHONGTAN_BIRTHDAY", label: "中壇元帥聖誕" },
  { value: "OTHER", label: "其他" },
];

// V10.1「供品認捐中心」用的標籤
export const offeringUnitLabel: Record<string, string> = {
  ZHI: "隻",
  DUI: "對",
  PAN: "盤",
  FEN: "份",
  ZU: "組",
  OTHER: "其他",
};

export const offeringUnitOptions: { value: string; label: string }[] = [
  { value: "ZHI", label: "隻" },
  { value: "DUI", label: "對" },
  { value: "PAN", label: "盤" },
  { value: "FEN", label: "份" },
  { value: "ZU", label: "組" },
  { value: "OTHER", label: "其他" },
];

export const offeringBehaviorKindLabel: Record<string, string> = {
  TURTLE: "壽龜",
  NOODLE_TOWER: "壽桃麵塔",
  LOOSE_PEACH: "散壽桃麵",
  FLORAL: "花果供品",
  GENERIC: "一般供品",
};

export const offeringClaimModeLabel: Record<string, string> = {
  INDIVIDUAL: "每份分開認捐",
  GROUPED: "合為一組認捐",
};

export const activityOfferingStatusLabel: Record<string, string> = {
  OPEN: "開放",
  FULL: "額滿",
  STOPPED: "停止",
  CLOSED: "結案",
};

export const activityOfferingStatusOptions: { value: string; label: string }[] = [
  { value: "OPEN", label: "開放" },
  { value: "FULL", label: "額滿" },
  { value: "STOPPED", label: "停止" },
  { value: "CLOSED", label: "結案" },
];

export const offeringClaimStatusLabel: Record<string, string> = {
  ACTIVE: "有效",
  CANCELLED: "已取消",
  REFUND_PENDING: "待退款/轉款",
  REFUNDED: "已退款/轉款",
};

export const offeringPaymentStatusLabel: Record<string, string> = {
  UNPAID: "未收款",
  PARTIAL: "部分收款",
  PAID: "已收清",
  WAIVED: "免收",
};

export const offeringPaymentStatusOptions: { value: string; label: string }[] = [
  { value: "UNPAID", label: "未收款" },
  { value: "PARTIAL", label: "部分收款" },
  { value: "PAID", label: "已收清" },
  { value: "WAIVED", label: "免收" },
];

export const offeringReceiptStatusLabel: Record<string, string> = {
  NOT_ISSUED: "尚未開立",
  ISSUED: "已開立",
  REPRINTED: "已補印",
};

export const offeringPaymentKindLabel: Record<string, string> = {
  PAYMENT: "收款",
  REFUND: "退款",
  TRANSFER_OUT: "轉出",
  TRANSFER_IN: "轉入",
};

export const stoveMasterRoleTypeLabel: Record<string, string> = {
  STOVE_MASTER: "爐主",
  VICE_STOVE_MASTER: "副爐主",
};

export const stoveMasterRoleTypeOptions: { value: string; label: string }[] = [
  { value: "STOVE_MASTER", label: "爐主" },
  { value: "VICE_STOVE_MASTER", label: "副爐主" },
];

export const stoveMasterStatusLabel: Record<string, string> = {
  ACTIVE: "有效",
  CANCELLED: "已取消",
};

export const templeEventStatusLabel: Record<string, string> = {
  PREPARING: "籌備中",
  ONGOING: "活動進行中",
  CLOSED: "已結案",
  CANCELLED: "已取消",
};

export const templeEventStatusOptions: { value: string; label: string }[] = [
  { value: "PREPARING", label: "籌備中" },
  { value: "ONGOING", label: "活動進行中" },
  { value: "CLOSED", label: "已結案" },
  { value: "CANCELLED", label: "已取消" },
];

// V2.0 祭祀資料核心（RitualRecord）用的標籤
export const ritualRecordStatusLabel: Record<string, string> = {
  DRAFT: "草稿",
  CONFIRMED: "已確認",
  CANCELLED: "已取消",
};

export const universalSalvationEntryCategoryLabel: Record<string, string> = {
  ANCESTOR_LINE: "歷代祖先",
  INDIVIDUAL_SOUL: "個人乙位正魂",
  DEBT_CREDITOR: "冤親債主",
  UNBORN_CHILD: "無緣子女",
};

// 列印時四個類別固定的顯示順序（型別故意不寫死成 keyof typeof
// universalSalvationEntryCategoryLabel——那個物件的宣告型別是 Record<string,
// string>，keyof 出來只會是寬鬆的 string，套進 Prisma 產生的精確 enum 型別會
// 編譯失敗。真正需要精確 enum 型別的地方，見 src/lib/ritual.ts 裡另外定義的
// ENTRY_CATEGORY_ORDER。這裡只保留給純顯示用途（例如畫面下拉選單）。
export const universalSalvationEntryCategoryOrder = [
  "ANCESTOR_LINE",
  "INDIVIDUAL_SOUL",
  "DEBT_CREDITOR",
  "UNBORN_CHILD",
] as const;

export const memberRoleLabel: Record<string, string> = {
  HOUSEHOLD_HEAD: "戶長",
  SPOUSE: "配偶",
  SON: "兒子",
  DAUGHTER: "女兒",
  FATHER: "父親",
  MOTHER: "母親",
  GRANDFATHER: "祖父",
  GRANDMOTHER: "祖母",
  OTHER: "其他",
};

// 新增家人表單用的下拉選項，順序依需求給定的順序
export const memberRoleOptions: { value: keyof typeof memberRoleLabel; label: string }[] = [
  { value: "HOUSEHOLD_HEAD", label: "戶長" },
  { value: "SPOUSE", label: "配偶" },
  { value: "SON", label: "兒子" },
  { value: "DAUGHTER", label: "女兒" },
  { value: "FATHER", label: "父親" },
  { value: "MOTHER", label: "母親" },
  { value: "GRANDFATHER", label: "祖父" },
  { value: "GRANDMOTHER", label: "祖母" },
  { value: "OTHER", label: "其他" },
];

// V12「信眾資料中心正式建置」指令「三／四」新增：出生時辰（十二時辰）標籤與
// 下拉選項。對應 Member.birthHour（String? 欄位，沿用 V11.3 既有設計，不是 Prisma
// enum），可接受值限制為下列 12 個固定代碼，驗證在應用程式層完成（見 API route）。
export const birthHourLabel: Record<string, string> = {
  ZI: "子時（23:00–01:00）",
  CHOU: "丑時（01:00–03:00）",
  YIN: "寅時（03:00–05:00）",
  MAO: "卯時（05:00–07:00）",
  CHEN: "辰時（07:00–09:00）",
  SI: "巳時（09:00–11:00）",
  WU: "午時（11:00–13:00）",
  WEI: "未時（13:00–15:00）",
  SHEN: "申時（15:00–17:00）",
  YOU: "酉時（17:00–19:00）",
  XU: "戌時（19:00–21:00）",
  HAI: "亥時（21:00–23:00）",
};

export const birthHourOptions: { value: keyof typeof birthHourLabel; label: string }[] = [
  { value: "ZI", label: "子時（23:00–01:00）" },
  { value: "CHOU", label: "丑時（01:00–03:00）" },
  { value: "YIN", label: "寅時（03:00–05:00）" },
  { value: "MAO", label: "卯時（05:00–07:00）" },
  { value: "CHEN", label: "辰時（07:00–09:00）" },
  { value: "SI", label: "巳時（09:00–11:00）" },
  { value: "WU", label: "午時（11:00–13:00）" },
  { value: "WEI", label: "未時（13:00–15:00）" },
  { value: "SHEN", label: "申時（15:00–17:00）" },
  { value: "YOU", label: "酉時（17:00–19:00）" },
  { value: "XU", label: "戌時（19:00–21:00）" },
  { value: "HAI", label: "亥時（21:00–23:00）" },
];

// V9.0「祭改管理與小人頭貼紙列印」用的標籤
export const purificationRegistrationStatusLabel: Record<string, string> = {
  ACTIVE: "有效",
  CANCELLED: "已取消",
  SUPPLEMENTARY: "補報",
};

export const purificationPaymentStatusLabel: Record<string, string> = {
  UNPAID: "未收款",
  PARTIAL: "部分收款",
  PAID: "已收款",
};

export const purificationPaymentStatusOptions: { value: "UNPAID" | "PARTIAL" | "PAID"; label: string }[] = [
  { value: "UNPAID", label: "未收款" },
  { value: "PARTIAL", label: "部分收款" },
  { value: "PAID", label: "已收款" },
];

// V9.1「附加列印項目與多寶袋管理機制」用的標籤
export const additionalPrintItemTypeLabel: Record<string, string> = {
  POCKET: "寶袋",
  TABLET: "牌位",
  PETITION: "疏文",
  LANTERN_TABLET: "燈牌",
  OTHER: "其他列印項目",
};

export const additionalPrintItemTypeOptions: { value: string; label: string }[] = [
  { value: "POCKET", label: "寶袋" },
  { value: "TABLET", label: "牌位" },
  { value: "PETITION", label: "疏文" },
  { value: "LANTERN_TABLET", label: "燈牌" },
  { value: "OTHER", label: "其他列印項目" },
];

export const additionalPrintItemStatusLabel: Record<string, string> = {
  PENDING_CONFIRMATION: "待確認",
  PENDING_PRINT: "待列印",
  PRINTED: "已列印",
  CANCELLED: "已取消",
};

export const additionalPrintItemStatusOptions: { value: string; label: string }[] = [
  { value: "PENDING_CONFIRMATION", label: "待確認" },
  { value: "PENDING_PRINT", label: "待列印" },
  { value: "PRINTED", label: "已列印" },
  { value: "CANCELLED", label: "已取消" },
];

// 需求「七」：新增寶袋時「預設／額外」標籤。
export const additionalPrintItemExtraLabel: Record<"true" | "false", string> = {
  true: "額外",
  false: "預設",
};

// ============================================================
// V11.0「全宮共用收款中心」用的標籤
// ============================================================

/**
 * 目前真正已串接、可以在收款中心實際操作的來源。
 *
 * ⚠️ V11.0.1 起，這裡不再自己維護一份清單——「哪個來源真的有 Adapter」
 * 這件事只有一個真相來源：`src/lib/receivableAdapters.ts` 的 registry。
 * `isReceivableSourceWired()` 直接查詢那個 registry，避免這裡的清單跟
 * 實際註冊的 Adapter 兜不起來（V11.0 版本這兩者是分開手動維護的兩份
 * 清單，這次改成單一事實來源）。
 */
export function isReceivableSourceWired(sourceType: string): boolean {
  return listWiredSourceTypes().includes(sourceType);
}

export const receivableSourceTypeLabel: Record<string, string> = {
  OFFERING_CLAIM: "供品認捐",
  MANUAL: "其他臨時應收項目",
  UNIVERSAL_SALVATION_SPONSOR: "普渡贊普",
  PURIFICATION_ENTRY: "祭改",
  // V13.3B：寶袋等附加列印項目。目前實際使用的只有寶袋（POCKET），
  // 名稱直接寫「寶袋」讓行政人員一眼看懂；若日後其他 itemType 也開放
  // 收費，再改成較通用的名稱。
  ADDITIONAL_PRINT_ITEM: "寶袋",
  // V13.4：年度燈（光明燈／太歲燈／全家燈共用同一個應收來源型別，
  // 實際是哪一種燈由 itemName 顯示）
  LANTERN_REGISTRATION: "年度燈",
  PEACE_LANTERN: "平安燈（尚未開放，功能開發中）",
  TAISUI_LANTERN: "太歲燈（尚未開放，功能開發中）",
  TREASURY_REPAYMENT: "補庫（尚未開放，功能開發中）",
  TEMPLE_CELEBRATION_OTHER: "宮慶其他應收（尚未開放，功能開發中）",
  DEITY_BIRTHDAY: "神明聖誕（尚未開放，功能開發中）",
  OIL_INCENSE_DONATION: "油香捐獻（尚未開放，功能開發中）",
  MERIT_DONATION: "功德捐獻（尚未開放，功能開發中）",
  DHARMA_ASSEMBLY: "法會報名（尚未開放，功能開發中）",
  SUTRA_CHANTING: "誦經（尚未開放，功能開發中）",
  OTHER_TEMPLE_ACTIVITY: "其他宮務活動（尚未開放，功能開發中）",
};

export const paymentMethodTypeLabel: Record<string, string> = {
  CASH: "現金",
  BANK_TRANSFER: "銀行轉帳",
  MOBILE_PAYMENT: "行動支付",
  CHECK: "支票",
  OTHER: "其他",
};

export const paymentMethodTypeOptions: { value: string; label: string }[] = [
  { value: "CASH", label: "現金" },
  { value: "BANK_TRANSFER", label: "銀行轉帳" },
  { value: "MOBILE_PAYMENT", label: "行動支付" },
  { value: "CHECK", label: "支票" },
  { value: "OTHER", label: "其他" },
];

export const paymentTransactionStatusLabel: Record<string, string> = {
  COMPLETED: "已完成",
  VOIDED: "已作廢",
};

export const agentRemittanceStatusLabel: Record<string, string> = {
  PENDING: "待繳回",
  PARTIALLY_REMITTED: "部分繳回",
  REMITTED: "已繳回",
  RECONCILED: "已對帳",
};

export const paymentAdjustmentTypeLabel: Record<string, string> = {
  REFUND: "退款",
  TRANSFER_TO_OTHER: "轉款到其他應收項目",
  RETAIN_AS_OVERPAYMENT: "保留為溢收",
  VOID_INCOMPLETE: "作廢（整筆收款）",
};

export const receivableReceiptLinkStatusLabel: Record<string, string> = {
  NOT_LINKED: "尚未開立收據",
  LINKED: "已開立收據",
  VOIDED: "收據已作廢", // 本輪刻意不在分配層級使用這個值，見 schema.prisma PaymentAllocation.receiptStatus 註解
};

// ============================================================
// V11.1「全宮共用收據中心」用的標籤
// ============================================================

export const receiptStatusLabel: Record<string, string> = {
  DRAFT: "草稿",
  ISSUED: "已開立",
  VOIDED: "已作廢",
  REPLACED: "已換開",
  NO_RECEIPT_REQUIRED: "不需開立",
};

export const receiptStatusColor: Record<string, string> = {
  ISSUED: "bg-sage-100 text-ink",
  VOIDED: "bg-cream-300 text-ink-faint",
  REPLACED: "bg-mist-100 text-ink",
  NO_RECEIPT_REQUIRED: "bg-cream-100 text-ink-faint",
  DRAFT: "bg-yolk-100 text-ink",
};

export const receiptTypeLabel: Record<string, string> = {
  MERGED: "合併開立",
  SPLIT_ITEM: "分項開立",
};

export const receiptPrintKindLabel: Record<string, string> = {
  ORIGINAL_PRINT: "正式列印",
  REPRINT: "補印",
};

export const receiptNumberYearModeLabel: Record<string, string> = {
  ROC: "民國年",
  WESTERN: "西元年",
};

export const receiptNumberResetPolicyLabel: Record<string, string> = {
  YEARLY: "每年重新起號",
  CONTINUOUS: "連續編號（不分年度）",
};

export const manualReceivableStatusLabel: Record<string, string> = {
  UNPAID: "未收款",
  PARTIAL: "部分收款",
  PAID: "已收清",
  WAIVED: "免收",
  CANCELLED: "已取消",
};

/**
 * V11.0.1 新增：需求「八、統一付款狀態計算」的 8 種狀態顯示文字——所有
 * 應收來源（供品認捐、臨時應收、普渡贊普、祭改…）的 `UniversalReceivableView
 * .paymentStatus` 一律用這份共用標籤顯示，不再讓各模組自己使用不同文字。
 */
export const universalPaymentStatusLabel: Record<string, string> = {
  UNPAID: "未付款",
  PARTIAL: "部分付款",
  PAID: "已付款",
  WAIVED: "免收",
  CANCELLED: "取消",
  REFUND_PENDING: "待退款",
  REFUNDED: "已退款",
  TRANSFERRED: "已轉款",
};

/**
 * 需求畫面用的狀態顏色。專案色票（tailwind.config.ts）目前只定義
 * cream（米白）/yolk（淡鵝黃）/blossom（淡粉）/mist（淡藍）/sage（淡綠）
 * 五種——不新增橘/紫/灰等額外色票（依專案規定不使用大面積純黑/純白/高飽和
 * 色，且色票需維持已確認的五色莫蘭迪配色）。跨年度／代收未繳回／已取消
 * 這三種需求裡沒有對應既有色票的狀態，改用既有色票的較深階（*-200/300）
 * 做出視覺區隔，而不是引入新顏色。
 */
export const collectionStatusColor: Record<string, string> = {
  PAID: "bg-sage-100 text-ink", // 已收清＝淡綠
  PARTIAL: "bg-yolk-100 text-ink", // 部分收款＝淡鵝黃
  UNPAID: "bg-blossom-100 text-ink", // 未收款＝淡粉
  CROSS_YEAR: "bg-yolk-200 text-ink", // 跨年度＝較深的淡鵝黃（沿用既有色票，不新增橘色）
  AGENT_UNCOLLECTED: "bg-mist-200 text-ink", // 代收未繳回＝較深的淡藍（沿用既有色票，不新增紫色）
  REFUNDED: "bg-mist-100 text-ink", // 已退款＝淡藍
  CANCELLED: "bg-cream-300 text-ink-faint", // 已取消＝米白較深階（沿用既有色票，不新增灰色）
  // V11.0.1 新增：統一付款狀態的其餘 3 種（WAIVED/REFUND_PENDING/TRANSFERRED）
  WAIVED: "bg-cream-100 text-ink-faint", // 免收＝米白
  REFUND_PENDING: "bg-blossom-200 text-ink", // 待退款＝較深的淡粉（沿用既有色票，不新增新顏色）
  TRANSFERRED: "bg-cream-200 text-ink-soft", // 已轉款＝米白中階
};

/** V11.2「系統管理中心 — 備份與還原中心」顯示文字。 */
export const backupTypeLabel: Record<string, string> = {
  MANUAL: "手動立即備份",
  DAILY: "每日自動",
  WEEKLY: "每週自動",
  MONTHLY: "每月自動",
  BEFORE_UPDATE: "更新前備份",
};

export const backupStatusLabel: Record<string, string> = {
  IN_PROGRESS: "進行中",
  SUCCESS: "成功",
  FAILED: "失敗",
};

export const backupStatusColor: Record<string, string> = {
  IN_PROGRESS: "bg-mist-100 text-ink",
  SUCCESS: "bg-sage-100 text-ink",
  FAILED: "bg-blossom-100 text-ink",
};

/** V11.2.1 新增：備份執行階段（對應指令「七、7. 顯示目前進度階段」）。 */
export const backupStageLabel: Record<string, string> = {
  ACQUIRING_LOCK: "準備開始",
  PREPARING: "準備資料",
  DUMPING_DATABASE: "匯出資料庫",
  WRITING_METADATA: "建立備份資訊",
  COMPRESSING: "壓縮檔案",
  UPLOADING: "上傳 Google Drive",
  FINALIZING: "寫入備份紀錄",
  DONE: "完成",
};

/** V11.2.1 新增：備份錯誤代碼（對應指令「八」錯誤分類）。 */
export const backupErrorCodeLabel: Record<string, string> = {
  GOOGLE_DRIVE_NOT_CONNECTED: "Google Drive 尚未連線",
  GOOGLE_AUTH_INVALID: "Google 授權失效",
  TOKEN_REFRESH_FAILED: "Token 換發失敗",
  GOOGLE_DRIVE_NO_PERMISSION: "Google Drive API 無權限",
  FOLDER_CREATE_FAILED: "資料夾建立失敗",
  PG_DUMP_NOT_FOUND: "pg_dump 不存在",
  DATABASE_DUMP_FAILED: "資料庫匯出失敗",
  ZIP_CREATE_FAILED: "ZIP 建立失敗",
  UPLOAD_FAILED: "上傳失敗",
  DISK_SPACE_INSUFFICIENT: "Render 暫存空間不足",
  UNKNOWN_ERROR: "未知系統錯誤",
};

/** V11.2.1 新增：備份完整性檢查結果（對應指令「十」）。 */
export const integrityCheckStatusLabel: Record<string, string> = {
  COMPLETE: "完整",
  FILE_NOT_FOUND: "檔案不存在",
  CHECKSUM_MISMATCH: "校驗失敗",
  ZIP_CORRUPT: "ZIP 損壞",
  CONTENT_MISSING: "必要內容缺漏",
  CHECK_FAILED: "檢查失敗",
};
