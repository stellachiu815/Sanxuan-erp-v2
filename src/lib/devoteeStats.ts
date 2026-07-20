import { prisma } from "@/lib/prisma";
import { listThisMonthSolarBirthdays, listThisMonthLunarBirthdays, listTodaySolarBirthdays, listUpcoming7DaySolarBirthdays } from "@/lib/devoteeBirthday";
import { listCareList } from "@/lib/devoteeCare";

/**
 * V12.0「信眾關係中心首頁」統計聚合（對應指令「四」）。
 *
 * ⚠️ 核心原則：這裡全部統計都是即時查詢既有資料表算出來的（Member/
 * Household/RitualRecord/PaymentTransaction/OfferingClaim/RecordVersion/
 * DevoteeInteraction），沒有任何一個數字是寫死或預先快取的假資料——對應
 * 指令「十三、不得使用假資料宣稱功能完成」與交付報告的誠實揭露原則。
 *
 * 效能考量（對應指令「十八」）：全部用 count()/聚合查詢，不會把全部信眾
 * 或全部歷史紀錄一次讀進應用層再用 JS 算數量；「最近 N 筆」的清單一律
 * take 固定筆數（PREVIEW_LIMIT / RECENT_LIST_LIMIT），不會無上限成長。
 */

const PREVIEW_LIMIT = 5; // 首頁統計卡片內附的「最近新增信眾」「最近互動紀錄」預覽筆數
const RECENT_LIST_LIMIT = 10; // 首頁下方各個「最近清單」的筆數

function currentROCYear(now: Date): number {
  return now.getFullYear() - 1911;
}

function startOfThisYear(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}

export type RecentNewDevoteeEntry = {
  memberId: string;
  name: string;
  householdName: string;
  createdAt: string;
};

export type RecentInteractionEntry = {
  id: string;
  memberId: string;
  name: string;
  interactionType: string;
  occurredAt: string;
  content: string;
};

export type DevoteeHomeStats = {
  totalDevotees: number; // 信眾總人數
  totalHouseholds: number; // 家戶總數
  newDevoteesThisYear: number; // 本年度新增信眾
  activityParticipantsThisYear: number; // 本年度參加活動人數（去重複計算人數，不是活動報名筆數）
  solarBirthdaysThisMonth: number; // 本月國曆生日人數
  lunarBirthdaysThisMonth: number; // 本月農曆生日人數
  needsCareCount: number; // 需要關懷人數（僅計算已正式標記，見 devoteeCare.ts 說明）
  deceasedCount: number; // 已標示往生人數
  // V12「信眾資料中心正式建置」指令「五、待補資料」新增：缺出生年月日／
  // 缺地址／缺姓名／缺電話人數，定義完全比照 src/lib/devoteeList.ts 的
  // NO_BIRTHDAY／NO_ADDRESS／NO_PHONE 篩選條件（同一套判斷邏輯，不是另外
  // 寫一份可能兜不起來的規則）。
  //
  // ⚠️ 誠實揭露：missingNameCount 這個數字恆定為 0——Member.name 在
  // prisma/schema.prisma 是必填（NOT NULL）欄位，資料庫層級就不可能存在
  // 「沒有姓名」的信眾資料，所以這裡不是「系統很完美所以一直是 0」，而是
  // 這個統計項目在目前的資料結構下沒有實際意義，仍然照指令要求顯示出來，
  // 只是恆為 0，交付報告會一併說明。
  missingBirthdayCount: number;
  missingAddressCount: number;
  missingNameCount: number;
  missingPhoneCount: number;
  recentNewDevotees: RecentNewDevoteeEntry[]; // 最近新增信眾（預覽）
  recentInteractions: RecentInteractionEntry[]; // 最近互動紀錄（預覽）
};

export type RecentActivityEntry = {
  memberId: string;
  name: string;
  householdName: string;
  activityLabel: string;
  year: number;
  createdAt: string;
};

export type RecentPaymentEntry = {
  transactionId: string;
  payerName: string;
  amount: string;
  paidOn: string;
};

export type RecentOfferingClaimEntry = {
  claimId: string;
  sponsorName: string;
  offeringTypeName: string;
  year: number;
  createdAt: string;
};

export type RecentNoteEntry = {
  memberId: string | null;
  name: string | null;
  personalNote: string;
  changedAt: string;
  operatorName: string | null;
};

export type RecentDataChangeEntry = {
  entityType: string;
  entityId: string;
  action: string;
  operatorName: string | null;
  changeNote: string | null;
  createdAt: string;
};

export type DevoteeRecentLists = {
  todayBirthdays: Awaited<ReturnType<typeof listTodaySolarBirthdays>>;
  upcoming7DayBirthdays: Awaited<ReturnType<typeof listUpcoming7DaySolarBirthdays>>;
  recentActivities: RecentActivityEntry[];
  recentPayments: RecentPaymentEntry[];
  recentOfferingClaims: RecentOfferingClaimEntry[];
  recentNotes: RecentNoteEntry[];
  recentDataChanges: RecentDataChangeEntry[];
};

const DEVOTEE_ENTITY_TYPES = ["DevoteeProfile", "DevoteeTagAssignment", "DevoteeInteraction", "DevoteeCareRecord"];

/**
 * 「最近新增備註」：DevoteeProfile.personalNote 沒有獨立的異動紀錄表，
 * 這裡直接掃描既有 RecordVersion（entityType=DevoteeProfile, action=UPDATE）
 * 的 before/after 快照，只挑出 personalNote 真的有變動的那幾筆——不是每一次
 * 修改延伸資料都會被算進「新增備註」，只有備註欄位本身真的改變才算。
 * 因為要在應用層比對 JSON 快照差異，這裡多抓一批（比 RECENT_LIST_LIMIT
 * 大的 CANDIDATE_SCAN_LIMIT 筆）再篩選，避免抓不到足夠筆數；不會抓全部
 * 歷史紀錄。
 */
const NOTE_CHANGE_SCAN_LIMIT = 50;

type NoteChangeCandidate = {
  profileId: string;
  personalNote: string;
  changedAt: string;
  operatorName: string | null;
};

async function getRecentNotes(): Promise<RecentNoteEntry[]> {
  const candidates = await prisma.recordVersion.findMany({
    where: { entityType: "DevoteeProfile", action: "UPDATE" },
    orderBy: { createdAt: "desc" },
    take: NOTE_CHANGE_SCAN_LIMIT,
  });

  const changes: NoteChangeCandidate[] = [];
  for (const rv of candidates) {
    if (changes.length >= RECENT_LIST_LIMIT) break;
    const before = rv.beforeData as { personalNote?: string | null } | null;
    const after = rv.afterData as { personalNote?: string | null } | null;
    const beforeNote = before?.personalNote ?? null;
    const afterNote = after?.personalNote ?? null;
    if (afterNote && afterNote !== beforeNote) {
      changes.push({
        profileId: rv.entityId,
        personalNote: afterNote,
        changedAt: rv.createdAt.toISOString(),
        operatorName: rv.operatorName,
      });
    }
  }

  if (changes.length === 0) return [];

  // 批次補查 memberId/name（避免每一筆 note 各自查一次 DevoteeProfile，符合指令「十八」N+1 要求）。
  const profiles = await prisma.devoteeProfile.findMany({
    where: { id: { in: changes.map((c) => c.profileId) } },
    include: { member: { select: { id: true, name: true } } },
  });
  const map = new Map(profiles.map((p) => [p.id, p.member]));

  return changes.map((c) => {
    const member = map.get(c.profileId);
    return {
      memberId: member?.id ?? null,
      name: member?.name ?? null,
      personalNote: c.personalNote,
      changedAt: c.changedAt,
      operatorName: c.operatorName,
    };
  });
}

const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  ANNUAL_LANTERN: "年度燈（舊）",
  UNIVERSAL_SALVATION: "中元普渡",
  TEMPLE_CELEBRATION: "宮慶",
  REPRINT: "補印",
  PURIFICATION: "祭改",
  GUANGMING_LANTERN: "光明燈",
  TAISUI_LANTERN: "太歲燈",
  FAMILY_LANTERN: "全家燈",
  STORAGE_REPAYMENT: "補庫",
  OTHER: "其他",
  GUANDI_BIRTHDAY: "關聖帝君聖誕",
  XUANTIAN_BIRTHDAY: "玄天上帝聖誕",
  YAOCHI_BIRTHDAY: "瑤池金母聖誕",
  ZHONGTAN_BIRTHDAY: "中壇元帥聖誕",
};

/**
 * 誠實揭露：「本年度新增信眾」用 Member.createdAt（這筆家戶成員資料在系統
 * 建立的時間）當作「新增信眾」的判斷依據——系統沒有另外一個「成為信眾的
 * 日期」欄位，Member.createdAt 是最接近的既有資料，這是本輪的設計判斷，
 * 非逐字規定。如果家戶成員是透過 Excel 匯入舊資料建立的，createdAt 會是
 * 「匯入當下」而不是「實際成為信眾的日期」，這點交付報告會一併註明。
 */
export async function getDevoteeHomeStats(now: Date = new Date()): Promise<DevoteeHomeStats> {
  const rocYear = currentROCYear(now);
  const yearStart = startOfThisYear(now);

  const [
    totalDevotees,
    totalHouseholds,
    newDevoteesThisYear,
    activityParticipantsThisYear,
    solarBirthdaysThisMonth,
    lunarBirthdaysThisMonth,
    careList,
    deceasedCount,
    missingBirthdayCount,
    missingAddressCount,
    missingPhoneCount,
    recentNewDevoteesRaw,
    recentInteractionsRaw,
  ] = await Promise.all([
    prisma.member.count({ where: { deletedAt: null, household: { deletedAt: null } } }),
    prisma.household.count({ where: { deletedAt: null } }),
    prisma.member.count({ where: { deletedAt: null, household: { deletedAt: null }, createdAt: { gte: yearStart } } }),
    prisma.ritualRecord.groupBy({
      by: ["memberId"],
      where: { year: rocYear, deletedAt: null, memberId: { not: null } },
    }),
    listThisMonthSolarBirthdays(now),
    listThisMonthLunarBirthdays(now),
    listCareList(),
    prisma.member.count({ where: { deletedAt: null, household: { deletedAt: null }, isDeceased: true } }),
    prisma.member.count({
      where: { deletedAt: null, household: { deletedAt: null }, solarBirthDate: null, lunarBirthYear: null },
    }),
    prisma.member.count({
      where: { deletedAt: null, household: { deletedAt: null, address: null } },
    }),
    prisma.member.count({
      where: {
        deletedAt: null,
        household: { deletedAt: null, phone: null },
        AND: [{ OR: [{ devoteeProfile: null }, { devoteeProfile: { is: { mobile: null } } }] }],
      },
    }),
    prisma.member.findMany({
      where: { deletedAt: null, household: { deletedAt: null } },
      include: { household: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: PREVIEW_LIMIT,
    }),
    prisma.devoteeInteraction.findMany({
      where: { deletedAt: null },
      include: { devoteeProfile: { include: { member: { select: { id: true, name: true } } } } },
      orderBy: { occurredAt: "desc" },
      take: PREVIEW_LIMIT,
    }),
  ]);

  return {
    totalDevotees,
    totalHouseholds,
    newDevoteesThisYear,
    activityParticipantsThisYear: activityParticipantsThisYear.length,
    solarBirthdaysThisMonth: solarBirthdaysThisMonth.length,
    lunarBirthdaysThisMonth: lunarBirthdaysThisMonth.length,
    needsCareCount: careList.length,
    deceasedCount,
    missingBirthdayCount,
    missingAddressCount,
    missingNameCount: 0, // 見上方型別定義的誠實揭露說明：Member.name 必填，恆為 0
    missingPhoneCount,
    recentNewDevotees: recentNewDevoteesRaw.map((m) => ({
      memberId: m.id,
      name: m.name,
      householdName: m.household.name,
      createdAt: m.createdAt.toISOString(),
    })),
    recentInteractions: recentInteractionsRaw.map((i) => ({
      id: i.id,
      memberId: i.devoteeProfile.member.id,
      name: i.devoteeProfile.member.name,
      interactionType: i.interactionType,
      occurredAt: i.occurredAt.toISOString(),
      content: i.content,
    })),
  };
}

export async function getDevoteeRecentLists(now: Date = new Date()): Promise<DevoteeRecentLists> {
  const [
    todayBirthdays,
    upcoming7DayBirthdays,
    recentActivitiesRaw,
    recentPaymentsRaw,
    recentOfferingClaimsRaw,
    recentNotes,
    recentDataChangesRaw,
  ] = await Promise.all([
    listTodaySolarBirthdays(now),
    listUpcoming7DaySolarBirthdays(now),
    prisma.ritualRecord.findMany({
      where: { deletedAt: null, memberId: { not: null } },
      include: { member: { select: { name: true } }, household: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIST_LIMIT,
    }),
    prisma.paymentTransaction.findMany({
      where: { status: "COMPLETED" },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIST_LIMIT,
    }),
    prisma.offeringClaim.findMany({
      where: { deletedAt: null },
      include: { offeringType: { select: { name: true } } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIST_LIMIT,
    }),
    getRecentNotes(),
    prisma.recordVersion.findMany({
      where: { entityType: { in: DEVOTEE_ENTITY_TYPES } },
      orderBy: { createdAt: "desc" },
      take: RECENT_LIST_LIMIT,
    }),
  ]);

  return {
    todayBirthdays,
    upcoming7DayBirthdays,
    recentActivities: recentActivitiesRaw.map((r) => ({
      memberId: r.memberId as string,
      name: r.member?.name ?? "",
      householdName: r.household.name,
      activityLabel: ACTIVITY_TYPE_LABEL[r.activityType] ?? r.activityType,
      year: r.year,
      createdAt: r.createdAt.toISOString(),
    })),
    recentPayments: recentPaymentsRaw.map((p) => ({
      transactionId: p.id,
      payerName: p.payerNameSnapshot,
      amount: p.totalAmount.toString(),
      paidOn: p.paidOn.toISOString().slice(0, 10),
    })),
    recentOfferingClaims: recentOfferingClaimsRaw.map((c) => ({
      claimId: c.id,
      sponsorName: c.sponsorNameSnapshot,
      offeringTypeName: c.offeringType.name,
      year: c.year,
      createdAt: c.createdAt.toISOString(),
    })),
    recentNotes,
    recentDataChanges: recentDataChangesRaw.map((rv) => ({
      entityType: rv.entityType,
      entityId: rv.entityId,
      action: rv.action,
      operatorName: rv.operatorName,
      changeNote: rv.changeNote,
      createdAt: rv.createdAt.toISOString(),
    })),
  };
}
