import { prisma } from "@/lib/prisma";

/**
 * V12.0「全宮整合搜尋」（對應指令「十二」）。
 *
 * ⚠️ 核心原則：這裡「只查詢既有資料表、組出可以點擊跳轉的連結」，不會把
 * 搜尋結果另外存成一份 CRM 專屬的快照資料（對應指令「十二、不得只複製結果
 * 快照到獨立的 CRM 儲存」）。每次呼叫都是即時查詢。
 *
 * ⚠️ 這是全新的「跨模組」搜尋，跟既有 src/app/api/search/route.ts（V1.1，
 * 只搜姓名/電話/地址/家戶編號，只給「快速找到某人」用）是兩個不同用途的
 * 功能，這裡刻意沒有修改、也沒有取代那支既有 API（對應指令「不得重新設計
 * 已完成的功能」）。
 *
 * 9 個分類，對應指令「十二」原文：信眾／家戶／宮務活動／祭祀資料／供品
 * 認捐／收款／收據／祭改／年度燈。
 *
 * 連結目標的選擇（誠實說明，非逐字規定，屬本輪判斷）：
 * - 信眾 → 信眾關係中心 360 總覽頁（本輪新增，路由 /devotee-center/[memberId]）
 * - 家戶 → 既有 /household/[id]
 * - 宮務活動 → 既有 /activities/[templeEventId]（通用活動主頁）
 * - 祭祀資料（歷代祖先/乙位正魂/冤親債主，來自 UniversalSalvationEntry）
 *   → 既有 /household/[householdId]/rituals/universal-salvation（該戶普渡
 *   祭祀資料頁面，目前系統唯一有陳列這些項目的頁面）
 * - 供品認捐 → 既有 /offering-center/member/[memberId]
 * - 收款 → 既有 /collection-center/payments/[transactionId]
 * - 收據 → 既有 /receipt-center/receipts/[receiptId]
 * - 祭改 → 既有 /purification/[templeEventId]（該年度祭改主頁，PurificationEntry
 *   本身沒有獨立頁面，只能連到年度清單頁再由行政人員找到該筆編號）
 * - 年度燈 → 既有 /activities/[templeEventId]（光明燈/太歲燈/全家燈都走通用
 *   活動主頁，系統目前沒有另外的年度燈專屬頁面）
 */

export type DevoteeSearchCategory =
  | "DEVOTEE"
  | "HOUSEHOLD"
  | "ACTIVITY"
  | "RITUAL"
  | "OFFERING_CLAIM"
  | "PAYMENT"
  | "RECEIPT"
  | "PURIFICATION"
  | "ANNUAL_LANTERN";

export const DEVOTEE_SEARCH_CATEGORY_LABEL: Record<DevoteeSearchCategory, string> = {
  DEVOTEE: "信眾",
  HOUSEHOLD: "家戶",
  ACTIVITY: "宮務活動",
  RITUAL: "祭祀資料",
  OFFERING_CLAIM: "供品認捐",
  PAYMENT: "收款",
  RECEIPT: "收據",
  PURIFICATION: "祭改",
  ANNUAL_LANTERN: "年度燈",
};

export type DevoteeSearchResult = {
  category: DevoteeSearchCategory;
  id: string;
  title: string; // 顯示的主要文字，例如信眾姓名、收據抬頭
  subtitle: string; // 顯示的輔助文字，例如所屬家戶、活動年度
  href: string; // 點擊跳轉到既有功能的正確頁面
};

export type DevoteeSearchResponse = {
  query: string;
  groups: { category: DevoteeSearchCategory; label: string; results: DevoteeSearchResult[] }[];
  total: number;
};

const PER_CATEGORY_LIMIT = 10; // 每個分類最多顯示筆數（對應指令「十八」：搜尋結果需要合理筆數上限，不能無限量回傳）

const LANTERN_ACTIVITY_TYPES = ["GUANGMING_LANTERN", "TAISUI_LANTERN", "FAMILY_LANTERN"] as const;

/**
 * 全宮整合搜尋主函式。
 *
 * 搜尋欄位對應指令「十二」原文：信眾姓名/家戶/家戶成員/電話/地址/活動/
 * 祭祀姓名/祖先名稱/乙位正魂/冤親債主/供品認捐人/收款人/收據抬頭/收據號碼。
 */
export async function searchAcrossTemple(q: string): Promise<DevoteeSearchResponse> {
  const query = q.trim();
  if (!query) return { query, groups: [], total: 0 };

  const [devotees, households, activities, rituals, offeringClaims, payments, receipts, purifications, lanterns] =
    await Promise.all([
      searchDevotees(query),
      searchHouseholds(query),
      searchActivities(query),
      searchRituals(query),
      searchOfferingClaims(query),
      searchPayments(query),
      searchReceipts(query),
      searchPurifications(query),
      searchAnnualLanterns(query),
    ]);

  const groups: {
  category: DevoteeSearchCategory;
  label: string;
  results: DevoteeSearchResult[];
}[] = [
    { category: "DEVOTEE" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.DEVOTEE, results: devotees },
    { category: "HOUSEHOLD" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.HOUSEHOLD, results: households },

{ category: "ACTIVITY" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.ACTIVITY, results: activities },

{ category: "RITUAL" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.RITUAL, results: rituals },

{ category: "OFFERING_CLAIM" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.OFFERING_CLAIM, results: offeringClaims },

{ category: "PAYMENT" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.PAYMENT, results: payments },

{ category: "RECEIPT" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.RECEIPT, results: receipts },

{ category: "PURIFICATION" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.PURIFICATION, results: purifications },

{ category: "ANNUAL_LANTERN" as DevoteeSearchCategory, label: DEVOTEE_SEARCH_CATEGORY_LABEL.ANNUAL_LANTERN, results: lanterns },
   
  ].filter((g) => g.results.length > 0);

  const total = groups.reduce((sum, g) => sum + g.results.length, 0);

  return { query, groups, total };
}

/** 信眾姓名/家戶成員/電話/地址（信眾角度） */
async function searchDevotees(q: string): Promise<DevoteeSearchResult[]> {
  const members = await prisma.member.findMany({
    where: {
      deletedAt: null,
      household: { deletedAt: null },
      OR: [
        { name: { contains: q } },
        { household: { phone: { contains: q } } },
        { household: { address: { contains: q } } },
        { devoteeProfile: { is: { mobile: { contains: q } } } },
      ],
    },
    include: { household: { select: { id: true, name: true } } },
    take: PER_CATEGORY_LIMIT,
  });

  return members.map((m) => ({
    category: "DEVOTEE" as const,
    id: m.id,
    title: m.name,
    subtitle: `${m.household.name}（${m.household.id}）`,
    href: `/devotee-center/${m.id}`,
  }));
}

/** 家戶編號/家戶名稱/電話/地址/公司名稱/主要聯絡人 */
async function searchHouseholds(q: string): Promise<DevoteeSearchResult[]> {
  const households = await prisma.household.findMany({
    where: {
      deletedAt: null,
      OR: [
        { id: { contains: q } },
        { name: { contains: q } },
        { phone: { contains: q } },
        { address: { contains: q } },
        { companyName: { contains: q } },
        { contactName: { contains: q } },
      ],
    },
    take: PER_CATEGORY_LIMIT,
  });

  return households.map((h) => ({
    category: "HOUSEHOLD" as const,
    id: h.id,
    title: h.name,
    subtitle: h.contactName ? `主要聯絡人：${h.contactName}` : h.id,
    href: `/household/${h.id}`,
  }));
}

/** 宮務活動名稱（不含祭改/年度燈——那兩類另外獨立分類顯示，避免同一筆資料出現在兩個分類） */
async function searchActivities(q: string): Promise<DevoteeSearchResult[]> {
  const events = await prisma.templeEvent.findMany({
    where: {
      name: { contains: q },
      activityType: { notIn: ["PURIFICATION", ...LANTERN_ACTIVITY_TYPES] },
    },
    take: PER_CATEGORY_LIMIT,
    orderBy: { year: "desc" },
  });

  return events.map((e) => ({
    category: "ACTIVITY" as const,
    id: e.id,
    title: e.name,
    subtitle: `民國 ${e.year} 年`,
    href: `/activities/${e.id}`,
  }));
}

/** 祭祀姓名/祖先名稱/乙位正魂/冤親債主（UniversalSalvationEntry.displayName） */
async function searchRituals(q: string): Promise<DevoteeSearchResult[]> {
  const entries = await prisma.universalSalvationEntry.findMany({
    where: { deletedAt: null, displayName: { contains: q } },
    include: {
      universalSalvation: { include: { ritualRecord: { include: { household: { select: { id: true, name: true } } } } } },
    },
    take: PER_CATEGORY_LIMIT,
  });

  const CATEGORY_LABEL: Record<string, string> = {
    ANCESTOR_LINE: "歷代祖先",
    INDIVIDUAL_SOUL: "個人乙位正魂",
    DEBT_CREDITOR: "冤親債主",
    UNBORN_CHILD: "無緣子女",
  };

  return entries.map((e) => {
    const household = e.universalSalvation.ritualRecord.household;
    return {
      category: "RITUAL" as const,
      id: e.id,
      title: e.displayName,
      subtitle: `${CATEGORY_LABEL[e.category] ?? e.category}・${household.name}（${household.id}）`,
      href: `/household/${household.id}/rituals/universal-salvation`,
    };
  });
}

/** 供品認捐人 */
async function searchOfferingClaims(q: string): Promise<DevoteeSearchResult[]> {
  const claims = await prisma.offeringClaim.findMany({
    where: { deletedAt: null, sponsorNameSnapshot: { contains: q } },
    include: { offeringType: { select: { name: true } } },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY_LIMIT,
  });

  return claims.map((c) => ({
    category: "OFFERING_CLAIM" as const,
    id: c.id,
    title: c.sponsorNameSnapshot,
    subtitle: `${c.offeringType.name}・民國 ${c.year} 年`,
    href: `/offering-center/member/${c.sponsorMemberId}`,
  }));
}

/** 收款人 */
async function searchPayments(q: string): Promise<DevoteeSearchResult[]> {
  const payments = await prisma.paymentTransaction.findMany({
    where: {
      OR: [{ payerNameSnapshot: { contains: q } }, { transactionNo: { contains: q } }],
    },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY_LIMIT,
  });

  return payments.map((p) => ({
    category: "PAYMENT" as const,
    id: p.id,
    title: p.payerNameSnapshot,
    subtitle: `${p.transactionNo}・${p.paidOn.toISOString().slice(0, 10)}`,
    href: `/collection-center/payments/${p.id}`,
  }));
}

/** 收據抬頭/收據號碼 */
async function searchReceipts(q: string): Promise<DevoteeSearchResult[]> {
  const receipts = await prisma.receipt.findMany({
    where: {
      OR: [{ payerName: { contains: q } }, { receiptNumber: { contains: q } }],
    },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY_LIMIT,
  });

  return receipts.map((r) => ({
    category: "RECEIPT" as const,
    id: r.id,
    title: r.payerName,
    subtitle: r.receiptNumber ?? "（尚未編號）",
    href: `/receipt-center/receipts/${r.id}`,
  }));
}

/** 祭改：登記姓名（信眾姓名或臨時報名姓名）/ 編號 */
async function searchPurifications(q: string): Promise<DevoteeSearchResult[]> {
  const entries = await prisma.purificationEntry.findMany({
    where: {
      deletedAt: null,
      OR: [
        { member: { is: { name: { contains: q } } } },
        { manualDisplayName: { contains: q } },
      ],
    },
    include: { member: { select: { name: true } }, templeEvent: { select: { id: true, name: true, year: true } } },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY_LIMIT,
  });

  return entries.map((e) => ({
    category: "PURIFICATION" as const,
    id: e.id,
    title: e.member?.name ?? e.manualDisplayName ?? "（未命名）",
    subtitle: `${e.templeEvent.name}${e.number ? `・第 ${e.number} 號` : ""}`,
    href: `/purification/${e.templeEvent.id}`,
  }));
}

/** 年度燈（光明燈/太歲燈/全家燈）：依家戶名稱或成員姓名搜尋 */
async function searchAnnualLanterns(q: string): Promise<DevoteeSearchResult[]> {
  const records = await prisma.ritualRecord.findMany({
    where: {
      deletedAt: null,
      activityType: { in: [...LANTERN_ACTIVITY_TYPES] },
      OR: [{ household: { name: { contains: q } } }, { member: { is: { name: { contains: q } } } }],
    },
    include: { household: { select: { id: true, name: true } }, member: { select: { name: true } }, templeEvent: { select: { id: true } } },
    orderBy: { createdAt: "desc" },
    take: PER_CATEGORY_LIMIT,
  });

  return records
    .filter((r) => r.templeEvent)
    .map((r) => ({
      category: "ANNUAL_LANTERN" as const,
      id: r.id,
      title: r.member?.name ?? r.household.name,
      subtitle: `${r.household.name}（${r.household.id}）・民國 ${r.year} 年`,
      href: `/activities/${r.templeEvent!.id}`,
    }));
}
