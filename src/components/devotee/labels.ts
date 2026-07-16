/**
 * V12.0「信眾關係中心」共用的中文標籤對照表，前端各頁面共用，避免各自
 *重複寫一份、之後改一個地方漏改其他頁面。
 */

/** 對應 prisma/schema.prisma 的 DevoteeInteractionType enum（指令「九」）。 */
export const DEVOTEE_INTERACTION_TYPE_LABEL: Record<string, string> = {
  PHONE_CALL: "電話聯絡",
  LINE_CONTACT: "LINE聯絡",
  VISIT: "現場來宮",
  ADDRESS_UPDATE: "地址更新",
  CARE_CONTACT: "關懷聯絡",
  ACTIVITY_INQUIRY: "詢問活動",
  RITUAL_INQUIRY: "詢問法會",
  OTHER: "其他",
};
