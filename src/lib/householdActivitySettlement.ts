/**
 * 家戶頁「本次活動結算」——信眾一問「我家這次多少錢」，一眼看完。
 *
 * ── 設計重點 ────────────────────────────────────────────────
 * 1. 只顯示「當下檔期活動」（isInSeason），跟著活動跑；活動辦完換檔，這裡
 *    自動改顯示新的當季活動。不累積歷史（歷史另有「歷史活動」區塊）。
 * 2. 金額一律撈**真實報名資料**（listRegisteredItems，與 /registration 頁、
 *    收款中心同一個來源），**不碰任何示意樣板**；總計算法與 RegisteredItemsPanel
 *    「本次報名總計」逐字一致（排除 CANCELLED 與 excludeFromTotal，加
 *    amountDue／amountPaid／amountUnpaid），確保跟報名頁對得起來。
 * 3. 純唯讀彙總：不建立、不修改任何資料、不需要任何資料庫欄位變更。
 */
import { prisma } from "@/lib/prisma";
import type { ActivityType } from "@prisma/client";
import { resolvePrintCenterActivities } from "@/lib/printCenterOverview";
import { listRegisteredItems } from "@/lib/registrationItemRegistration";

export type SettlementLine = {
  /** 報名者／成員姓名（可能為空）。 */
  registrantName: string | null;
  /** 已報名項目最終顯示字串（類別｜姓名／牌位名稱／本人…）。 */
  displayLabel: string;
  contentKind: string;
  unitPrice: number | null;
  quantity: number;
  amountDue: number;
  amountUnpaid: number;
};

export type HouseholdActivitySettlement = {
  activityGroup: string;
  /** 中元普渡／年度燈… */
  activityGroupName: string;
  activityType: string;
  year: number;
  ritualRecordId: string;
  status: string;
  lines: SettlementLine[];
  totalDue: number;
  totalPaid: number;
  totalUnpaid: number;
};

/**
 * 取得某家戶在「當下檔期活動」的報名結算（可能同時有多個當季活動，例如
 * 普渡與年度燈同時開；各自一塊，另在畫面加總）。沒有進行中報名時回空陣列。
 */
export async function getHouseholdCurrentActivitySettlements(
  householdId: string,
  now: Date = new Date()
): Promise<HouseholdActivitySettlement[]> {
  const activities = (await resolvePrintCenterActivities(now)).filter(
    (a) => a.isInSeason && a.activityType && a.year != null
  );

  const out: HouseholdActivitySettlement[] = [];
  for (const a of activities) {
    const records = await prisma.ritualRecord.findMany({
      where: {
        householdId,
        activityType: a.activityType as ActivityType,
        year: a.year as number,
        deletedAt: null,
      },
      select: { id: true, status: true },
      orderBy: { createdAt: "asc" },
    });

    for (const record of records) {
      const items = await listRegisteredItems(record.id);
      // 與 RegisteredItemsPanel「本次報名總計」逐字一致的計入條件。
      const active = items.filter((it) => it.status !== "CANCELLED" && !it.excludeFromTotal);
      if (active.length === 0) continue;

      const lines: SettlementLine[] = active.map((it) => ({
        registrantName: it.memberName,
        displayLabel: it.displayLabel,
        contentKind: it.contentKind,
        unitPrice: it.unitPrice,
        quantity: it.quantity,
        amountDue: it.amountDue,
        amountUnpaid: it.amountUnpaid,
      }));

      out.push({
        activityGroup: a.activityGroup,
        activityGroupName: a.activityGroupName,
        activityType: a.activityType as string,
        year: a.year as number,
        ritualRecordId: record.id,
        status: record.status,
        lines,
        totalDue: active.reduce((s, it) => s + it.amountDue, 0),
        totalPaid: active.reduce((s, it) => s + it.amountPaid, 0),
        totalUnpaid: active.reduce((s, it) => s + it.amountUnpaid, 0),
      });
    }
  }

  return out;
}
