import { prisma } from "@/lib/prisma";
import { findDuplicateMatches, DUPLICATE_MATCH_REASON_LABEL, type DuplicateCandidate, type DuplicateMatch } from "@/lib/devoteeDuplicateMatcher";

/**
 * V12.0「疑似重複信眾」（對應指令「十三」）：從既有 Member/Household/
 * DevoteeProfile 組出比對候選清單，交給 devoteeDuplicateMatcher.ts 的
 * 純函式做實際比對。這裡「只查詢、不合併」——沒有任何合併資料的函式，
 * 呼叫端只能取得比對結果做人工確認。
 */

export type DuplicateGroupView = {
  reason: string;
  reasonLabel: string;
  members: { memberId: string; name: string; householdId: string; householdName: string }[];
};

export async function listSuspectedDuplicateDevotees(): Promise<DuplicateGroupView[]> {
  const members = await prisma.member.findMany({
    where: { deletedAt: null, household: { deletedAt: null } },
    include: { household: { select: { id: true, name: true, phone: true, address: true } }, devoteeProfile: { select: { mobile: true } } },
  });

  const candidates: DuplicateCandidate[] = members.map((m) => ({
    memberId: m.id,
    name: m.name,
    phone: m.devoteeProfile?.mobile || m.household.phone || null,
    address: m.household.address || null,
    birthdayKey: m.solarBirthDate
      ? `solar:${m.solarBirthDate.toISOString().slice(0, 10)}`
      : m.lunarBirthYear && m.lunarBirthMonth && m.lunarBirthDay
        ? `lunar:${m.lunarBirthYear}-${m.lunarBirthMonth}-${m.lunarBirthDay}-${m.lunarIsLeapMonth}`
        : null,
    householdId: m.householdId,
  }));

  const matches = findDuplicateMatches(candidates);

  const householdNameMap = new Map(members.map((m) => [m.householdId, m.household.name]));
  const nameMap = new Map(members.map((m) => [m.id, m.name]));

  // 依 reason 分組顯示，每一組列出兩位信眾（畫面可以自行合併同一組多筆配對）。
  const groups: DuplicateGroupView[] = matches.map((m: DuplicateMatch) => ({
    reason: m.reason,
    reasonLabel: DUPLICATE_MATCH_REASON_LABEL[m.reason],
    members: [
      { memberId: m.a.memberId, name: nameMap.get(m.a.memberId) ?? m.a.name, householdId: m.a.householdId, householdName: householdNameMap.get(m.a.householdId) ?? "" },
      { memberId: m.b.memberId, name: nameMap.get(m.b.memberId) ?? m.b.name, householdId: m.b.householdId, householdName: householdNameMap.get(m.b.householdId) ?? "" },
    ],
  }));

  return groups;
}
