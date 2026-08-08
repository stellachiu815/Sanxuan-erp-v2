/**
 * V38 登記完自動轉正式（best-effort）。
 *
 * Stella 定案：所有活動、所有報名路徑「登記完就轉正式」，不再留草稿。
 * ⚠️ **不自動帶入報名成員**（姓名等資料一律人工把關）——沒有報名成員／資料不齊的少數，
 *    confirmRegistration 會失敗，就**留草稿**供人工更正，不硬確認、不亂補人。
 * 一律在 registerItemsBatch 的交易**提交後**呼叫（交易外），確認失敗不影響已建立的報名。
 */
export async function autoConfirmRegistrations(
  recordIds: string[],
  operatorName: string | null
): Promise<void> {
  // 動態載入避免與 activityRegistration ↔ registrationItemRegistration 形成靜態循環相依。
  const { confirmRegistration } = await import("@/lib/activityRegistration");
  for (const id of [...new Set(recordIds.filter(Boolean))]) {
    try {
      await confirmRegistration(id, operatorName);
    } catch {
      /* 確認不了（例如尚未選報名成員）→ 留草稿，人工更正 */
    }
  }
}
