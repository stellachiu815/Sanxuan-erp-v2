import { prisma } from "@/lib/prisma";
import { checkRitualRecordCompleteness } from "@/lib/completenessGate";

/**
 * V15R3：首頁「資料待補」彙總與清單——**純讀取**（不 update／upsert／create／delete、
 * 不自動補值、不改狀態）。掃描未刪除、且底下有有效報名項目的 RitualRecord，逐筆套
 * checkRitualRecordCompleteness（沿用同一套 dataCompleteness 規則），列出仍缺欄位者。
 *
 * ⚠️ 為避免全表掃描過重，預設只看「近年度視窗」（本民國年 ±1）且每次上限 500 筆；
 * 需要更廣時由呼叫端帶 filters.year。
 */
export type IncompleteRow = {
  ritualRecordId: string;
  memberName: string | null;
  householdId: string;
  householdName: string | null;
  year: number;
  activityGroupName: string;
  activityType: string;
  missingFields: string[];
  status: string;
};

export type CompletenessSummary = {
  total: number;
  annualLantern: number;
  universalSalvationTabletAddress: number;
  universalSalvationOther: number;
  dragonPhoenix: number;
};

export type CompletenessFilters = {
  year?: number;
  activityType?: string;
  missingField?: string;
  memberName?: string;
  householdId?: string;
};

const GROUP_ANNUAL = "年度燈";
const GROUP_DRAGON = "龍鳳燈";
const GROUP_US = "中元普渡";

async function scanIncomplete(filters?: CompletenessFilters): Promise<IncompleteRow[]> {
  const rocYear = new Date().getFullYear() - 1911;
  const records = await prisma.ritualRecord.findMany({
    where: {
      deletedAt: null,
      registrationItems: { some: { deletedAt: null, status: { not: "CANCELLED" } } },
      ...(filters?.year ? { year: filters.year } : { year: { gte: rocYear - 1, lte: rocYear + 1 } }),
      ...(filters?.activityType ? { activityType: filters.activityType as never } : {}),
      ...(filters?.householdId ? { householdId: filters.householdId } : {}),
    },
    select: {
      id: true, year: true, activityType: true, status: true, householdId: true,
      household: { select: { name: true } },
      registrationItems: {
        where: { deletedAt: null, status: { not: "CANCELLED" } },
        select: { member: { select: { name: true } }, registrationItemType: { select: { activityGroupName: true } } },
        take: 1,
      },
    },
    take: 500,
    orderBy: { updatedAt: "desc" },
  });

  const rows: IncompleteRow[] = [];
  for (const rec of records) {
    const c = await checkRitualRecordCompleteness(rec.id);
    if (c.complete) continue;
    const labels = c.missing.map((m) => m.label);
    if (filters?.missingField && !labels.includes(filters.missingField)) continue;
    const memberName = rec.registrationItems[0]?.member?.name ?? null;
    if (filters?.memberName && !(memberName ?? "").includes(filters.memberName)) continue;
    rows.push({
      ritualRecordId: rec.id,
      memberName,
      householdId: rec.householdId,
      householdName: rec.household?.name ?? null,
      year: rec.year,
      activityGroupName: rec.registrationItems[0]?.registrationItemType?.activityGroupName ?? rec.activityType,
      activityType: rec.activityType,
      missingFields: labels,
      status: rec.status,
    });
  }
  return rows;
}

/** 純讀取：待補清單（可篩選）。 */
export async function listIncompleteRegistrations(filters?: CompletenessFilters): Promise<IncompleteRow[]> {
  return scanIncomplete(filters);
}

/** 純讀取：首頁卡片彙總數字。 */
export async function getDataCompletenessSummary(): Promise<CompletenessSummary> {
  const rows = await scanIncomplete();
  let annualLantern = 0, dragon = 0, usTabletAddr = 0, usOther = 0;
  for (const r of rows) {
    if (r.activityGroupName === GROUP_ANNUAL) annualLantern++;
    else if (r.activityGroupName === GROUP_DRAGON) dragon++;
    else if (r.activityGroupName === GROUP_US) {
      if (r.missingFields.includes("牌位地址")) usTabletAddr++;
      else usOther++;
    }
  }
  return { total: rows.length, annualLantern, universalSalvationTabletAddress: usTabletAddr, universalSalvationOther: usOther, dragonPhoenix: dragon };
}
