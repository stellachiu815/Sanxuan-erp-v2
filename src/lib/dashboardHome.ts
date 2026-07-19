import { prisma } from "@/lib/prisma";
import { getCurrentRitualYear } from "@/lib/ritual";
import {
  listTodaySolarBirthdays,
  listTodayLunarBirthdays,
  type BirthdayEntry,
} from "@/lib/devoteeBirthday";
import { listTodayTempleEvents, type TodayTempleEventEntry } from "@/lib/templeEvents";
import {
  getTodayCollectionSummary,
  getCollectionHomeSummary,
  type TodayCollectionSummary,
} from "@/lib/collectionCenter";

/**
 * V11.2「首頁 Dashboard（系統總覽）」聚合邏輯。
 *
 * ⚠️ 開發原則（對應指令「開發原則」）：這裡完全不新增任何資料表、不建立
 * 快取——全部 6 張卡片的數字都是這支函式即時呼叫既有模組（信眾生日中心／
 * 宮務活動中心／全宮共用收款中心／全宮共用收據中心／信眾統計）已經寫好、
 * 已經在別的頁面使用中的查詢／函式組合出來的，只有「今日活動」「今日收款」
 * 「代收待繳回最長天數」這三個目前真的沒有既有函式可以直接沿用的小查詢，
 * 分別以最小幅度直接加在它們各自本來就負責的檔案裡（templeEvents.ts／
 * collectionCenter.ts），不是另外重新設計一套。信眾人數／家戶數／活動數／
 * 收據數這 4 個「年度統計」數字，因為只需要單純計數、既有的
 * getDevoteeHomeStats()／getReceiptStats() 會順便算出很多這張卡片用不到的
 * 額外資料（本年度新增信眾、生日清單、收據明細分組等），這裡選擇直接下
 * 4 支對應的 prisma.count()（跟那些既有函式內部用的計數查詢寫法完全一致），
 * 避免首頁載入時執行一堆不需要的額外查詢。
 */

export type DashboardAnnualStats = {
  devoteeCount: number;
  householdCount: number;
  activityCount: number;
  receiptCount: number;
};

export type DashboardHomeSummary = {
  rocYear: number;
  todaySolarBirthdays: BirthdayEntry[];
  todayLunarBirthdays: BirthdayEntry[];
  todayActivities: TodayTempleEventEntry[];
  todayCollection: TodayCollectionSummary;
  pendingReceivable: { count: number; amount: number };
  agentPending: { count: number; amount: number; longestDaysOutstanding: number };
  annualStats: DashboardAnnualStats;
};

export async function getDashboardHomeSummary(now: Date = new Date()): Promise<DashboardHomeSummary> {
  const rocYear = getCurrentRitualYear(now);
  const startOfYear = new Date(now.getFullYear(), 0, 1);

  const [
    todaySolarBirthdays,
    todayLunarBirthdays,
    todayActivities,
    todayCollection,
    collectionSummary,
    devoteeCount,
    householdCount,
    activityCount,
    receiptCount,
  ] = await Promise.all([
    listTodaySolarBirthdays(now),
    listTodayLunarBirthdays(now),
    listTodayTempleEvents(now),
    getTodayCollectionSummary(now),
    getCollectionHomeSummary(rocYear, now),
    // 沿用 devoteeStats.ts getDevoteeHomeStats() 內部使用的同一種計數寫法，
    // 只取這張卡片需要的兩個數字，不呼叫整支函式（見上方檔案說明）。
    prisma.member.count({ where: { deletedAt: null, household: { deletedAt: null } } }),
    prisma.household.count({ where: { deletedAt: null } }),
    prisma.templeEvent.count({ where: { year: rocYear } }),
    // 沿用 receipt.ts getReceiptStats()/getReceiptHomeSummary() 內部使用的
    // 同一種「本年度已開立收據」計數寫法。
    prisma.receipt.count({ where: { status: "ISSUED", receiptTime: { gte: startOfYear } } }),
  ]);

  return {
    rocYear,
    todaySolarBirthdays,
    todayLunarBirthdays,
    todayActivities,
    todayCollection,
    pendingReceivable: {
      count: collectionSummary.pendingReceivableCount,
      amount: collectionSummary.pendingReceivableAmount,
    },
    agentPending: {
      count: collectionSummary.agentPendingCount,
      amount: collectionSummary.agentPendingAmount,
      longestDaysOutstanding: collectionSummary.agentPendingLongestDays,
    },
    annualStats: { devoteeCount, householdCount, activityCount, receiptCount },
  };
}
