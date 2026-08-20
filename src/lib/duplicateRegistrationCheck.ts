/**
 * V41 重複報名偵測：查某位信眾「今年已經報名的項目」，供各報名入口在**選到既有信眾的當下**
 * 就提示（不擋、只提醒），避免同一個人／同一活動重複報名。
 *
 * 規則：只看這位 member 自己、該民國年、未取消／未刪除、家戶未封存的報名項目。
 * 回傳每個項目的活動名與項目名，前端顯示如「⚠️ 今年已報：補庫、光明燈×2、累世冤親債主」。
 * 依項目彙總（同項目多筆顯示 ×N）。
 */
import { prisma } from "@/lib/prisma";

export type MemberYearRegistration = { itemKey: string; itemName: string; activityGroupName: string; count: number };

export async function getMemberCurrentYearRegistrations(
  memberId: string,
  year: number
): Promise<MemberYearRegistration[]> {
  if (!memberId) return [];
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      memberId,
      deletedAt: null,
      status: { not: "CANCELLED" },
      ritualRecord: { deletedAt: null, year, household: { deletedAt: null } },
    },
    select: {
      quantity: true,
      registrationItemType: { select: { key: true, name: true, activityGroupName: true } },
    },
  });
  // 依項目 key 彙總筆數（一人同項目多筆＝×N）。
  const byKey = new Map<string, MemberYearRegistration>();
  for (const it of items) {
    const t = it.registrationItemType;
    const cur = byKey.get(t.key);
    if (cur) cur.count += 1;
    else byKey.set(t.key, { itemKey: t.key, itemName: t.name, activityGroupName: t.activityGroupName, count: 1 });
  }
  return [...byKey.values()];
}

/** 前端顯示用：組成「補庫、光明燈×2、累世冤親債主」這種一行字。空回空字串。 */
export function formatMemberYearRegistrations(list: MemberYearRegistration[]): string {
  return list.map((r) => (r.count > 1 ? `${r.itemName}×${r.count}` : r.itemName)).join("、");
}
