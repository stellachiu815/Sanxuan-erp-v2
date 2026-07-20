import { prisma } from "@/lib/prisma";
import { composeDevoteeSummary, DEVOTEE_SUMMARY_INCLUDE, type DevoteeSummary } from "@/lib/devoteeProfile";
import { solarToLunar } from "@/lib/lunar";
import { memberSearchOrConditions } from "@/lib/devoteeSearchFields";
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
  | "TAG_COMMITTEE" // 宮委
  // V12「信眾資料中心正式建置」指令「五／六」新增：缺出生年月日／資料完整，
  // 定義比照 devoteeStats 的「完整度」規則——完整＝有姓名（Member.name 為
  // 必填欄位，恆定成立）＋有國曆或農曆出生年月日其中一種＋所屬家戶有地址；
  // 缺一項即為不完整。「缺地址」「缺電話」沿用既有的 NO_ADDRESS／NO_PHONE，
  // 不重複新增。
  | "NO_BIRTHDAY" // 缺出生年月日（國曆、農曆皆未登記）
  | "DATA_COMPLETE"; // 資料完整（姓名＋生日其中一種＋家戶地址，三項皆有）

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

/**
 * 把「搜尋關鍵字＋篩選條件」組成 Prisma where 條件——從 listDevotees() 抽出來
 * 獨立成一個函式，讓 V12 指令「七、上一位／下一位」的鄰位查詢
 * （getAdjacentDevoteeIds()，見下方）可以套用「跟目前列表完全相同」的搜尋／
 * 篩選條件，不用另外重寫一份、也不會兩邊條件之後改了其中一邊卻忘記改
 * 另一邊而不一致。
 *
 * ⚠️ 唯一例外：BIRTHDAY_THIS_MONTH 篩選在 listDevotees() 裡，資料庫條件只能
 * 縮小到「有國曆生日 或 農曆月份等於本月」的近似範圍，真正精確的國曆月份
 * 比對是在取得分頁資料「之後」用應用層再篩一次（見 listDevotees() 內的
 * filteredMembers）。鄰位查詢無法套用那段分頁後過濾，所以套用這個篩選時，
 * 「上一位／下一位」的範圍會是這個近似條件，不是最終精確結果——這個篩選
 * 本來就不是指令「六」要求的四個快速篩選按鈕之一，屬於既有的細部篩選，
 * 這個極少數情境下的誤差已經在交付報告中列出。
 */
export function buildDevoteeWhere(query: DevoteeListQuery, now: Date = new Date()): Prisma.MemberWhereInput {
  const rocYear = currentROCYear(now);
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const where: Prisma.MemberWhereInput = {
    deletedAt: null,
    household: { deletedAt: null },
  };
  const andConditions: Prisma.MemberWhereInput[] = [];

  const q = query.q?.trim();
  if (q) {
    // V12.2 指令「七、搜尋邏輯收斂」：共同的信眾／家戶欄位改用單一規格
    // memberSearchOrConditions()（見 src/lib/devoteeSearchFields.ts），
    // 讓首頁快速搜尋、信眾名單、全宮搜尋不會再各自分歧。
    //
    // 下面三個是「信眾名單專屬」的額外欄位（Email／LINE ID／標籤）——名單頁
    // 本來就有標籤篩選與聯絡方式欄位，這些不屬於三套搜尋的共同基準，所以
    // 疊加在共用規格之上，不反向塞進共用檔案裡影響另外兩套。
    andConditions.push({
      OR: [
        ...memberSearchOrConditions(q),
        { devoteeProfile: { is: { email: { contains: q } } } },
        { devoteeProfile: { is: { lineId: { contains: q } } } },
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
      case "NO_BIRTHDAY":
        // 對應指令「五、缺出生年月日」：國曆、農曆都沒有登記才算「缺」。
        // 只檢查 lunarBirthYear 是否為 null 就足以代表「有沒有登記農曆生日」
        // ——既有新增成員 API（src/app/api/households/[id]/members/route.ts）
        // 一律把年/月/日三個欄位一起寫入或一起留空，不會出現只有月日沒有年
        // 的情況。
        andConditions.push({ solarBirthDate: null, lunarBirthYear: null });
        break;
      case "DATA_COMPLETE":
        // 對應指令「五、資料完整」定義：有姓名（Member.name 必填，恆成立）
        // ＋有國曆或農曆出生年月日其中一種＋所屬家戶有地址。
        andConditions.push({
          OR: [{ solarBirthDate: { not: null } }, { lunarBirthYear: { not: null } }],
        });
        andConditions.push({ household: { address: { not: null } } });
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

  return where;
}

export async function listDevotees(query: DevoteeListQuery): Promise<DevoteeListResult> {
  const page = Math.max(1, query.page ?? 1);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, query.pageSize ?? DEFAULT_PAGE_SIZE));
  const now = new Date();
  const where = buildDevoteeWhere(query, now);

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

export type AdjacentDevoteeIds = {
  prevMemberId: string | null;
  nextMemberId: string | null;
};

/**
 * V12「信眾資料中心正式建置」指令「七、上一位／下一位」。
 *
 * 排序依據跟名單預設排序（listDevotees() 的 orderBy: { name: "asc" }）一致，
 * 另外加上 id 當第二排序鍵當作 tie-break（姓名可能重複，只用姓名沒辦法
 * 唯一決定「上一位/下一位」是哪一位）——這個 tie-break 只影響同名信眾之間
 * 的相對順序，不會讓名單本身的排序看起來跟現在不一樣。
 *
 * query 帶入跟目前列表頁「完全相同」的搜尋關鍵字／篩選條件，這樣行政人員
 * 從一個「待補資料」篩選過的名單點進某一位信眾之後，上一位/下一位只會在
 * 這個篩選範圍內移動，才是指令原文「方便完成資料補登工作流程」真正的用途
 * ——如果不帶篩選條件，上一位/下一位會在全宮信眾裡移動，篩選過的畫面下
 * 一鍵反而跳出篩選範圍，變成不連續的工作流程。
 */
export async function getAdjacentDevoteeIds(memberId: string, query: DevoteeListQuery): Promise<AdjacentDevoteeIds> {
  const current = await prisma.member.findUnique({ where: { id: memberId }, select: { name: true } });
  if (!current) return { prevMemberId: null, nextMemberId: null };

  const where = buildDevoteeWhere(query);

  const [prev, next] = await Promise.all([
    prisma.member.findFirst({
      where: {
        AND: [where, { OR: [{ name: { lt: current.name } }, { name: current.name, id: { lt: memberId } }] }],
      },
      orderBy: [{ name: "desc" }, { id: "desc" }],
      select: { id: true },
    }),
    prisma.member.findFirst({
      where: {
        AND: [where, { OR: [{ name: { gt: current.name } }, { name: current.name, id: { gt: memberId } }] }],
      },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: { id: true },
    }),
  ]);

  return { prevMemberId: prev?.id ?? null, nextMemberId: next?.id ?? null };
}
