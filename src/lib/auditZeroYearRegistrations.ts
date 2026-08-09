import { prisma } from "@/lib/prisma";

/**
 * 找出所有「民國 0 年（或年度 ≤ 0）」的報名——這些是修正 batch-options 年度 bug
 * 之前留下的孤兒資料（整戶普渡報名沒選年度就送出 → 建成年度 0）。
 *
 * 純唯讀：只列出來讓管理者辨識、逐一清掉，不刪除、不修改任何資料。
 */
export type ZeroYearRegistration = {
  ritualRecordId: string;
  householdId: string;
  householdName: string;
  activityType: string;
  year: number;
  status: string;
  createdAt: string;
};

export type ZeroYearAuditReport = {
  ok: boolean;
  total: number;
  records: ZeroYearRegistration[];
};

export async function auditZeroYearRegistrations(): Promise<ZeroYearAuditReport> {
  const rows = await prisma.ritualRecord.findMany({
    where: { year: { lte: 0 }, deletedAt: null },
    select: {
      id: true,
      householdId: true,
      activityType: true,
      year: true,
      status: true,
      createdAt: true,
      household: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const records: ZeroYearRegistration[] = rows.map((r) => ({
    ritualRecordId: r.id,
    householdId: r.householdId,
    householdName: r.household?.name ?? "",
    activityType: r.activityType,
    year: r.year,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
  }));

  return { ok: true, total: records.length, records };
}
