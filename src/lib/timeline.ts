import type { ActivityType, RitualRecordStatus, UniversalSalvationEntryCategory } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  activityTypeLabel,
  ritualRecordStatusLabel,
  universalSalvationEntryCategoryLabel,
} from "@/lib/labels";
import { getCurrentRitualYear, getRecentRitualYears } from "@/lib/ritual";

/**
 * V6.0「信眾時間軸」的資料整合邏輯（唯讀，不寫入任何資料）。
 *
 * 這支只是「整合現有資料來源、攤平成同一種格式」，本身不建立任何新資料表：
 * 1. RitualRecord（+ UniversalSalvationDetail + 登記項目）——目前唯一有實際
 *    內容的來源，年度燈/宮慶尚未開發，之後這兩個模組有資料時，會自動一起
 *    出現在這裡（因為都存在同一張 RitualRecord 表），不用改這支函式。
 * 2. Activity（舊資料表）——只讀，不再寫入（V2.0 已經明確標記這張表停用）。
 *    目前正式環境與種子資料裡這張表完全是空的，所以時間軸目前不會顯示任何
 *    這個來源的項目；保留這段查詢是為了「萬一之後真的有舊資料要整合進來」
 *    不用重新設計，而不是假裝有資料。
 * 3. 家戶資料異動紀錄——目前系統沒有任何「家戶欄位被誰在何時改成什麼」的
 *    紀錄表（AuditLog 目前只服務財務模組，且系統完全沒有登入/操作者身份），
 *    所以這個資料來源本輪沒有東西可以整合，是已知限制，不會顯示、也不會
 *    生成假資料。
 */

export type TimelineMemberRef = { id: string; name: string } | null;

export type TimelineUniversalSalvationSummary = {
  isRegistered: boolean;
  ancestorLineCount: number;
  individualSoulCount: number;
  debtCreditorCount: number;
  unbornChildCount: number;
  isSponsor: boolean;
  tableNumber: string | null;
};

export type TimelineUniversalSalvationEntry = {
  category: UniversalSalvationEntryCategory;
  categoryLabel: string;
  displayName: string;
  yangshangName: string | null;
  notes: string | null;
};

export type TimelineUniversalSalvationDetail = {
  yangshangName: string | null;
  enshrinementLocation: string | null;
  isSponsor: boolean;
  sponsorQuantity: number | null;
  sponsorUnitPrice: string | null;
  sponsorAmount: string | null;
  sponsorNotes: string | null;
  tableNumber: string | null;
  notes: string | null;
  entries: TimelineUniversalSalvationEntry[];
};

export type TimelineEntry = {
  /** 這筆紀錄實際來自哪個資料來源，畫面可以用來決定要不要顯示「僅供參考的舊資料」提示。 */
  source: "RITUAL_RECORD" | "LEGACY_ACTIVITY";
  id: string;
  /** 年度（民國年）；只有舊 Activity 資料的 year 欄位可能是 null（當初就沒填）。 */
  year: number | null;
  activityType: ActivityType;
  activityTypeLabel: string;
  status: RitualRecordStatus | null;
  statusLabel: string | null;
  /** null 代表家戶共同紀錄（RitualRecord.memberId 未填，或來源是舊 Activity——本來就沒有這個欄位）。 */
  member: TimelineMemberRef;
  notes: string | null;
  createdAt: string;
  /** 舊 Activity 資料沒有 updatedAt 欄位，固定回傳 null。 */
  updatedAt: string | null;
  universalSalvationSummary: TimelineUniversalSalvationSummary | null;
  universalSalvationDetail: TimelineUniversalSalvationDetail | null;
};

export type HouseholdTimelineView = {
  household: { id: string; name: string };
  members: { id: string; name: string }[];
  /** 這個家戶「有紀錄」的所有年度，由新到舊；null 年度的舊資料不計入這個清單（另外用「年度不詳」分組顯示）。 */
  years: number[];
  currentRitualYear: number;
  recentYears: number[];
  entries: TimelineEntry[];
};

function countByCategory(
  entries: { category: UniversalSalvationEntryCategory }[],
  category: UniversalSalvationEntryCategory
): number {
  return entries.filter((e) => e.category === category).length;
}

/**
 * 取得某戶完整時間軸資料（家戶視角/成員視角/年度篩選都在畫面端用這一份
 * 資料做篩選，這支只負責一次撈齊、攤平——「任何篩選都只影響畫面」正是靠
 * 這種設計達成：篩選不會重新查詢或修改資料庫）。
 */
export async function getHouseholdTimeline(householdId: string): Promise<HouseholdTimelineView | null> {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    include: {
      // V8.0「刪除保護」：Member 也有 deletedAt 欄位（雖然目前還沒有刪除
      // 成員的 UI/API），時間軸一併過濾掉，保持跟其他查詢一致。
      members: {
        where: { deletedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, name: true },
      },
      activities: { orderBy: [{ year: "desc" }, { createdAt: "desc" }] },
      ritualRecords: {
        // V8.0「刪除保護」：移入回收區的普渡登記與登記項目不會出現在時間軸——
        // 資料本身還在（軟刪除），只是被過濾掉，還原後會重新出現。
        where: { deletedAt: null },
        orderBy: [{ year: "desc" }, { activityType: "asc" }],
        include: {
          member: { select: { id: true, name: true } },
          universalSalvation: {
            include: {
              entries: {
                where: { deletedAt: null },
                orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
              },
            },
          },
        },
      },
    },
  });

  if (!household) return null;

  const ritualEntries: TimelineEntry[] = household.ritualRecords.map((r) => {
    const detail = r.universalSalvation;
    let summary: TimelineUniversalSalvationSummary | null = null;
    let fullDetail: TimelineUniversalSalvationDetail | null = null;

    if (detail) {
      summary = {
        isRegistered: detail.isRegistered,
        ancestorLineCount: countByCategory(detail.entries, "ANCESTOR_LINE"),
        individualSoulCount: countByCategory(detail.entries, "INDIVIDUAL_SOUL"),
        debtCreditorCount: countByCategory(detail.entries, "DEBT_CREDITOR"),
        unbornChildCount: countByCategory(detail.entries, "UNBORN_CHILD"),
        isSponsor: detail.isSponsor,
        tableNumber: detail.tableNumber,
      };

      fullDetail = {
        yangshangName: detail.yangshangName,
        enshrinementLocation: detail.enshrinementLocation,
        isSponsor: detail.isSponsor,
        sponsorQuantity: detail.sponsorQuantity,
        sponsorUnitPrice: detail.sponsorUnitPrice ? detail.sponsorUnitPrice.toString() : null,
        sponsorAmount: detail.sponsorAmount ? detail.sponsorAmount.toString() : null,
        sponsorNotes: detail.sponsorNotes,
        tableNumber: detail.tableNumber,
        notes: r.notes,
        entries: detail.entries.map((e) => ({
          category: e.category,
          categoryLabel: universalSalvationEntryCategoryLabel[e.category] ?? e.category,
          displayName: e.displayName,
          yangshangName: e.yangshangName,
          notes: e.notes,
        })),
      };
    }

    return {
      source: "RITUAL_RECORD",
      id: r.id,
      year: r.year,
      activityType: r.activityType,
      activityTypeLabel: activityTypeLabel[r.activityType] ?? r.activityType,
      status: r.status,
      statusLabel: ritualRecordStatusLabel[r.status] ?? r.status,
      member: r.member ? { id: r.member.id, name: r.member.name } : null,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      universalSalvationSummary: summary,
      universalSalvationDetail: fullDetail,
    };
  });

  // 舊 Activity 資料：只讀顯示，不補年度、不補狀態、不假裝有 updatedAt——
  // 有什麼欄位就顯示什麼，沒有的一律 null，不生成假資料。
  const legacyEntries: TimelineEntry[] = household.activities.map((a) => ({
    source: "LEGACY_ACTIVITY",
    id: a.id,
    year: a.year,
    activityType: a.type,
    activityTypeLabel: activityTypeLabel[a.type] ?? a.type,
    status: null,
    statusLabel: null,
    member: null,
    notes: a.note,
    createdAt: a.createdAt.toISOString(),
    updatedAt: null,
    universalSalvationSummary: null,
    universalSalvationDetail: null,
  }));

  const allEntries = [...ritualEntries, ...legacyEntries].sort((x, y) => {
    // 年度不詳（null）一律排在最後面，其餘由新到舊。
    if (x.year === null && y.year === null) return 0;
    if (x.year === null) return 1;
    if (y.year === null) return -1;
    if (y.year !== x.year) return y.year - x.year;
    return x.activityTypeLabel.localeCompare(y.activityTypeLabel, "zh-Hant");
  });

  const years = Array.from(
    new Set(allEntries.map((e) => e.year).filter((y): y is number => y !== null))
  ).sort((a, b) => b - a);

  return {
    household: { id: household.id, name: household.name },
    members: household.members,
    years,
    currentRitualYear: getCurrentRitualYear(),
    recentYears: getRecentRitualYears(),
    entries: allEntries,
  };
}
