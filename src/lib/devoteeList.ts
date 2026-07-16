import { prisma } from "@/lib/prisma";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE, type DevoteeSummary } from "@/lib/devoteeProfile";
import { solarToLunar } from "@/lib/lunar";
import type { Prisma } from "@prisma/client";

/**
 * V12.0「信眾名單」（對應指令「五」）。
 *
 * 對應指令「十八、效能要求」：
 * - 名單使用分頁（skip/take，資料庫層級分頁，不是抓全部再前端切頁）。
 * - 搜尋/篩選全部在 Prisma where 條件完成，不在前端做大量全資料比對。
 * - 「最近參加活動」「最近收款日期」這兩欄需要跨資料表關聯，為了避免
 *   N+1（對每一列各自查一次），採用「先分頁取出這一頁的 memberId，
 *   再用兩個批次查詢（groupBy + IN 這一頁的 memberId）」的方式，全部
 *   名單只需要固定 3 支查詢（分頁本體 + 2 個批次聚合），不會隨頁面筆數
 *   增加而增加查詢次數。
 */

export type DevoteeListFilter =
  | "ACTIVE" // 在用
  | "DISABLED" // 停用
  | "DECEASED" // 已往生
  | "HAS_PHONE" // 有電話
  | "NO_PHONE" // 無電話
  | "HAS_ADDRESS" // 有地址
  | "NO_ADDRESS" // 無地址
  | "BIRTHDAY_THIS_MONTH" // 本月生日（國曆或農曆任一）
  | "ACTIVE_THIS_YEAR" // 本年度參加活動
  | "INACTIVE_OVER_1YEAR" // 一年以上未參加活動
  | "NEEDS_CARE" // 需要關懷（已正式標記）
  | "TAG_VIP"
  | "TAG_VOLUNTEER" // 義工
  | "TAG_COMMITTEE"; // 宮委

export type DevoteeListQuery = {
  q?: string; // 姓名/電話/手機/地址/家戶編號/主要聯絡人/公司名稱/Email/LINE ID/標籤 共用關鍵字搜尋
  filters?: DevoteeListFilter[];
  page?: number; // 1-based
  pageSize?: number;
};

export type DevoteeListRow = DevoteeSummary & {
  tags: string[];
  lastActivityAt: string | null; // 最近參加活動日期
  lastPaymentAt: string | null; // 最近收款日期
};

export type DevoteeListResult = {
  rows: DevoteeListRow[];
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

function currentROCYear(now: Date): number {
  return now.getFullYear() - 1911;
}

export async function listDevotees(query: DevoteeListQuery): Promise<DevoteeListResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const now = new Date();
  const rocYear = currentROCYear(now);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const where: Prisma.MemberWhereInput = {
    deletedAt: null,
    household: { deletedAt: null },
  };
  const andConditions: Prisma.MemberWhereInput[] = [];

  const q = query.q?.trim();
  if (q) {
    andConditions.push({
      OR: [
        { name: { contains: q } },
        { household: { phone: { contains: q } } },
        { household: { address: { contains: q } } },
        { household: { id: { contains: q } } },
        { household: { contactName: { contains: q } } },
        { household: { companyName: { contains: q } } },
        { devoteeProfile: { is: { mobile: { contains: q } } } },
        { devoteeProfile: { is: { email: { contains: q } } } },
        { devoteeProfile: { is: { lineId: { contains: q } } } },
        { devoteeProfile: { is: { companyName: { contains: q } } } },
        { devoteeProfile: { is: { tagAssignments: { some: { tag: { name: { contains: q } } } } } } },
      ],
    });
  }

  for (const f of query.filters ?? []) {
    switch (f) {
      case "ACTIVE":
        andConditions.push({ OR: [{ devoteeProfile: null }, { devoteeProfile: { is: { isDisabled: false } } }] });
        break;
      case "DISABLED":
        andConditions.push({ devoteeProfile: { is: { isDisabled: true } } });
        break;
      case "DECEASED":
        andConditions.push({ isDeceased: true });
        break;
      case "HAS_PHONE":
        andConditions.push({
          OR: [{ devoteeProfile: { is: { mobile: { not: null } } } }, { household: { phone: { not: null } } }],
        });
        break;
      case "NO_PHONE":
        andConditions.push({
          AND: [{ OR: [{ devoteeProfile: null }, { devoteeProfile: { is: { mobile: null } } }] }, { household: { phone: null } }],
        });
        break;
      case "HAS_ADDRESS":
        andConditions.push({ household: { address: { not: null } } });
        break;
      case "NO_ADDRESS":
        andConditions.push({ household: { address: null } });
        break;
      case "ACTIVE_THIS_YEAR":
        andConditions.push({ ritualRecords: { some: { year: rocYear, deletedAt: null } } });
        break;
      case "INACTIVE_OVER_1YEAR":
        // 對應指令「五、一年以上未參加活動」——同樣的既有資料限制見
        // devoteeCare.ts 的說明：只計算能明確關聯到本人（memberId）的
        // RitualRecord，家戶層級、沒有指定特定成員的登記不會被計入。
        andConditions.push({ ritualRecords: { none: { createdAt: { gte: oneYearAgo }, deletedAt: null } } });
        break;
      case "NEEDS_CARE":
        andConditions.push({ devoteeProfile: { is: { careFlag: true } } });
        break;
      case "TAG_VIP":
        andConditions.push({ devoteeProfile: { is: { tagAssignments: { some: { tag: { name: "VIP" } } } } } });
        break;
      case "TAG_VOLUNTEER":
        andConditions.push({ devoteeProfile: { is: { tagAssignments: { some: { tag: { name: "義工" } } } } } });
        break;
      case "TAG_COMMITTEE":
        andConditions.push({ devoteeProfile: { is: { tagAssignments: { some: { tag: { name: "宮委" } } } } } });
        break;
      case "BIRTHDAY_THIS_MONTH": {
        // Prisma 沒有直接「只比對月份、忽略年份」的 Date 過濾器，這裡先用
        // 資料庫條件縮小到「有國曆生日 或 農曆月份等於本月」的範圍，國曆
        // 生日的實際月份比對放到下面「filteredMembers」那段對已分頁完成
        // 的這一頁資料再精確過濾一次（只作用在固定 pageSize 筆資料上，
        // 不是對全宮資料做全表比對，符合指令「十八」效能要求）。
        const lunarMonth = solarToLunar(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))).month;
        andConditions.push({ OR: [{ solarBirthDate: { not: null } }, { lunarBirthMonth: lunarMonth }] });
        break;
      }
    }
  }

  if (andConditions.length > 0) where.AND = andConditions;

  const [total, members] = await Promise.all([
    prisma.member.count({ where }),
    prisma.member.findMany({
      where,
      include: {
        ...DEVOTEE_SUMMARY_INCLUDE,
        devoteeProfile: {
          include: { tagAssignments: { include: { tag: true } } },
        },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  // 本月生日篩選裡的國曆月份比對，用應用層對這一頁資料再過濾一次
  // （只作用在已經分頁、筆數固定為 pageSize 的資料上，不是對全宮資料做
  // 全表比對）。
  let filteredMembers = members;
  if (query.filters?.includes("BIRTHDAY_THIS_MONTH")) {
    const solarMonth = now.getUTCMonth();
    const currentLunarMonth = solarToLunar(new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))).month;
    filteredMembers = members.filter(
      (m) =>
        (m.solarBirthDate && m.solarBirthDate.getUTCMonth() === solarMonth) ||
        m.lunarBirthMonth === currentLunarMonth
    );
  }

  const memberIds = filteredMembers.map((m) => m.id);

  const [lastActivity, lastPayment] = await Promise.all([
    memberIds.length
      ? prisma.ritualRecord.groupBy({
          by: ["memberId"],
          where: { memberId: { in: memberIds }, deletedAt: null },
          _max: { createdAt: true },
        })
      : Promise.resolve([]),
    memberIds.length
      ? prisma.paymentTransaction.groupBy({
          by: ["payerMemberId"],
          where: { payerMemberId: { in: memberIds }, status: "COMPLETED" },
          _max: { paidOn: true },
        })
      : Promise.resolve([]),
  ]);

  const activityMap = new Map(lastActivity.filter((r) => r.memberId).map((r) => [r.memberId as string, r._max.createdAt]));
  const paymentMap = new Map(lastPayment.filter((r) => r.payerMemberId).map((r) => [r.payerMemberId as string, r._max.paidOn]));

  const rows: DevoteeListRow[] = filteredMembers.map((m) => {
    const summary = composeDevoteeSummary(m as Parameters<typeof composeDevoteeSummary>[0]);
    return {
      ...summary,
      tags: m.devoteeProfile?.tagAssignments.map((a) => a.tag.name) ?? [],
      lastActivityAt: activityMap.get(m.id)?.toISOString().slice(0, 10) ?? null,
      lastPaymentAt: paymentMap.get(m.id)?.toISOString().slice(0, 10) ?? null,
    };
  });

  return { rows, total, page, pageSize };
}
