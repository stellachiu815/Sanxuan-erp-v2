import { prisma } from "@/lib/prisma";
import { recordVersion, toJsonSnapshot } from "@/lib/recordVersion";
import { getOrCreateDevoteeProfile } from "@/lib/devoteeProfile";

/**
 * V12.0「需要關懷名單」（對應指令「十一」）。
 *
 * ⚠️ 核心規則，逐字對照：「系統不得自行把長期未參加活動的人直接標示為
 * 需要關懷。只能列為系統建議，由管理者決定是否正式標記。」
 *
 * 這裡明確區分兩種狀態，不能混為一談：
 * 1. 「已正式標記」（DevoteeProfile.careFlag = true）——只有管理者呼叫
 *    flagDevoteeForCare() 才會變成 true，系統自己的計算邏輯永遠不會寫入
 *    這個欄位。
 * 2. 「系統建議」（listSuggestedCareCandidates() 回傳，且明確標示
 *    source）——單純是「符合某個條件」的計算結果，不會寫進資料庫、不會
 *    出現在 careFlag 欄位，管理者看到建議後可以選擇呼叫
 *    flagDevoteeForCare() 把某個人「正式標記」，也可以選擇忽略。
 */

const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;
const STALE_CONTACT_YEARS = 2; // 「長期未更新電話或地址」的判斷門檻——本輪設計判斷，非逐字規定，見下方說明

export type CareListEntry = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  contact: string | null; // 手機優先，其次電話
  careReason: string; // 已正式標記時＝careReason；系統建議時＝建議理由文字
  lastContactedAt: string | null;
  nextContactSuggestedAt: string | null;
  careAssignedToName: string | null;
  careNote: string | null;
  isOfficiallyFlagged: boolean;
  suggestionSources: string[]; // 空陣列代表純粹是「已正式標記」，不是系統建議
};

/**
 * 已正式標記需要關懷的信眾清單（管理者已確認的名單，直接查 careFlag=true）。
 */
export async function listCareList(): Promise<CareListEntry[]> {
  const profiles = await prisma.devoteeProfile.findMany({
    where: { careFlag: true },
    include: {
      member: {
        include: { household: { select: { id: true, name: true, phone: true } } },
      },
    },
    orderBy: { nextContactSuggestedAt: "asc" },
  });

  return profiles
    .filter((p) => !p.member.deletedAt)
    .map((p) => ({
      memberId: p.memberId,
      name: p.member.name,
      householdId: p.member.householdId,
      householdName: p.member.household.name,
      contact: p.mobile || p.member.household.phone || null,
      careReason: p.careReason ?? "（管理者已標記，未填寫原因）",
      lastContactedAt: p.lastContactedAt ? p.lastContactedAt.toISOString().slice(0, 10) : null,
      nextContactSuggestedAt: p.nextContactSuggestedAt ? p.nextContactSuggestedAt.toISOString().slice(0, 10) : null,
      careAssignedToName: p.careAssignedToName,
      careNote: p.careNote,
      isOfficiallyFlagged: true,
      suggestionSources: [],
    }));
}

/**
 * 系統建議關懷名單（對應指令「十一」列出的三種系統建議來源）：
 * - 設定下次聯絡日期，且已經到期或即將到期（7 天內）
 * - 一年以上未參加任何宮務活動（依 RitualRecord.createdAt 概略判斷，見下方誠實說明）
 * - 長期未更新電話或地址（DevoteeProfile 從未建立、或建立後超過
 *   STALE_CONTACT_YEARS 年沒有任何欄位更新，且完全沒有手機/電話/地址）
 *
 * ⚠️ 誠實揭露：「一年以上未參加活動」的判斷，這裡用「該信眾名下最近一筆
 * RitualRecord 的 createdAt」概略代表「最近一次參加活動」——RitualRecord
 * 本身有 memberId 可為空的情況（例如以家戶為單位的普渡登記沒有指定特定
 * 成員），這種「以家戶登記、沒有指定特定成員」的參與不會被算進某一位
 * 個別信眾的「最近參加活動」，這是既有資料結構本身的限制，不是本輪新增
 * 的臆測邏輯，畫面與交付報告都會清楚註明這個限制。
 */
export async function listSuggestedCareCandidates(): Promise<CareListEntry[]> {
  const now = new Date();
  const oneYearAgo = new Date(now.getTime() - ONE_YEAR_MS);
  const staleContactThreshold = new Date(now.getTime() - STALE_CONTACT_YEARS * ONE_YEAR_MS);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const members = await prisma.member.findMany({
    where: { deletedAt: null, isDeceased: false, household: { deletedAt: null } },
    include: {
      household: { select: { id: true, name: true, phone: true, address: true } },
      devoteeProfile: true,
      ritualRecords: { select: { createdAt: true }, orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const results: CareListEntry[] = [];

  for (const m of members) {
    if (m.devoteeProfile?.careFlag) continue; // 已經正式標記的不重複出現在「建議」清單

    const sources: string[] = [];
    const lastActivityAt = m.ritualRecords[0]?.createdAt ?? null;

    if (m.devoteeProfile?.nextContactSuggestedAt && m.devoteeProfile.nextContactSuggestedAt <= sevenDaysFromNow) {
      sources.push("下次聯絡日期已到期或即將到期（7 天內）");
    }
    if (!lastActivityAt || lastActivityAt < oneYearAgo) {
      sources.push("一年以上未參加宮務活動（僅計算能明確關聯到本人的活動紀錄）");
    }
    const hasAnyContact = !!(m.devoteeProfile?.mobile || m.household.phone || m.household.address);
    const staleUpdate =
      (m.devoteeProfile ? m.devoteeProfile.updatedAt : m.updatedAt) < staleContactThreshold;
    if (!hasAnyContact && staleUpdate) {
      sources.push(`長期（${STALE_CONTACT_YEARS} 年以上）未更新電話或地址，且目前完全沒有聯絡方式`);
    }

    if (sources.length === 0) continue;

    results.push({
      memberId: m.id,
      name: m.name,
      householdId: m.householdId,
      householdName: m.household.name,
      contact: m.devoteeProfile?.mobile || m.household.phone || null,
      careReason: sources.join("；"),
      lastContactedAt: m.devoteeProfile?.lastContactedAt ? m.devoteeProfile.lastContactedAt.toISOString().slice(0, 10) : null,
      nextContactSuggestedAt: m.devoteeProfile?.nextContactSuggestedAt
        ? m.devoteeProfile.nextContactSuggestedAt.toISOString().slice(0, 10)
        : null,
      careAssignedToName: m.devoteeProfile?.careAssignedToName ?? null,
      careNote: m.devoteeProfile?.careNote ?? null,
      isOfficiallyFlagged: false,
      suggestionSources: sources,
    });
  }

  return results;
}

/** 管理者正式標記需要關懷（對應指令「十一」：由管理者決定是否正式標記）。 */
export async function flagDevoteeForCare(
  memberId: string,
  reason: string,
  assignedToName: string | null,
  operatorName: string
) {
  const profile = await getOrCreateDevoteeProfile(memberId);

  const after = await prisma.devoteeProfile.update({
    where: { id: profile.id },
    data: { careFlag: true, careReason: reason, careAssignedToName: assignedToName },
  });

  const record = await prisma.devoteeCareRecord.create({
    data: { devoteeProfileId: profile.id, action: "FLAGGED", reason, assignedToName, createdByName: operatorName },
  });

  await recordVersion({
    entityType: "DevoteeCareRecord",
    entityId: record.id,
    action: "CREATE",
    afterData: toJsonSnapshot({ profile: after, record }),
    operatorName,
    changeNote: `正式標記信眾（${memberId}）需要關懷：${reason}`,
  });

  return after;
}

/** 取消關懷標記。 */
export async function unflagDevoteeCare(memberId: string, operatorName: string) {
  const profile = await prisma.devoteeProfile.findUnique({ where: { memberId } });
  if (!profile) return null;

  const after = await prisma.devoteeProfile.update({
    where: { id: profile.id },
    data: { careFlag: false, careReason: null, careAssignedToName: null },
  });

  const record = await prisma.devoteeCareRecord.create({
    data: { devoteeProfileId: profile.id, action: "UNFLAGGED", createdByName: operatorName },
  });

  await recordVersion({
    entityType: "DevoteeCareRecord",
    entityId: record.id,
    action: "UPDATE",
    afterData: toJsonSnapshot({ profile: after, record }),
    operatorName,
    changeNote: `取消信眾（${memberId}）的關懷標記`,
  });

  return after;
}

/** 記錄一次關懷聯絡（更新最後聯絡日期/下次聯絡日期/備註），不改變 careFlag 本身。 */
export async function recordDevoteeCareContact(
  memberId: string,
  input: { contactedAt: Date; nextContactDate?: Date | null; note?: string | null },
  operatorName: string
) {
  const profile = await getOrCreateDevoteeProfile(memberId);

  const after = await prisma.devoteeProfile.update({
    where: { id: profile.id },
    data: {
      lastContactedAt: input.contactedAt,
      ...(input.nextContactDate !== undefined ? { nextContactSuggestedAt: input.nextContactDate } : {}),
      ...(input.note !== undefined ? { careNote: input.note } : {}),
    },
  });

  const record = await prisma.devoteeCareRecord.create({
    data: {
      devoteeProfileId: profile.id,
      action: "CONTACTED",
      note: input.note ?? null,
      createdByName: operatorName,
    },
  });

  await recordVersion({
    entityType: "DevoteeCareRecord",
    entityId: record.id,
    action: "UPDATE",
    afterData: toJsonSnapshot({ profile: after, record }),
    operatorName,
    changeNote: `記錄信眾（${memberId}）的一次關懷聯絡`,
  });

  return after;
}
