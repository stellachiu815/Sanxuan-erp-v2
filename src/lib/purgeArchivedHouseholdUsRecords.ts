import { prisma } from "@/lib/prisma";
import { deleteUniversalSalvationRecord } from "@/lib/ritual";

/**
 * V38 收乾淨「已封存家戶」底下還開著的普渡報名。
 *
 * 背景：封存家戶只收了家戶＋成員，**沒有連普渡報名（RitualRecord）一起收**，
 * 造成封存後「列印看不到、但報名名單／總數還算得到」的不一致（例：已封存的
 * F00886、F00887 仍出現在名單）。
 *
 * 這支把「家戶已封存、但普渡報名還開著」的紀錄一次軟刪（deletedAt）。因為列印／
 * 名單／總數／匯出全都以 ritualRecord.deletedAt IS NULL 過濾，軟刪後**所有地方一致**
 * 少掉這幾筆，總數才對。軟刪可從回收區還原。
 *
 * 安全：**只收未收款、未列印**的報名；任一筆項目已收款或已列印 → 擋下不動、如實回報
 * （不隱藏牽涉金錢／已印出的資料）。commit=false 預覽、true 才執行。
 */

export type PurgeRow = {
  ritualRecordId: string;
  householdId: string;
  householdName: string | null;
  year: number;
  eligible: boolean;
  blocker: string | null;
  removed?: boolean;
};
export type PurgeArchivedReport = {
  ok: boolean;
  commit: boolean;
  year: number | null;
  rows: PurgeRow[];
  removed: number;
};

export async function purgeArchivedHouseholdUsRecords(opts: {
  year?: number | null;
  householdIds?: string[] | null;
  commit: boolean;
  operatorName?: string | null;
}): Promise<PurgeArchivedReport> {
  const commit = !!opts.commit;

  const records = await prisma.ritualRecord.findMany({
    where: {
      activityType: "UNIVERSAL_SALVATION",
      deletedAt: null,
      // 家戶已封存（deletedAt 非 null）＝這筆報名應該一起被收起來。
      household: { deletedAt: { not: null } },
      ...(opts.year ? { year: opts.year } : {}),
      ...(opts.householdIds && opts.householdIds.length ? { householdId: { in: opts.householdIds } } : {}),
    },
    select: {
      id: true,
      year: true,
      householdId: true,
      household: { select: { name: true } },
      registrationItems: {
        where: { deletedAt: null },
        select: { amountPaid: true, printCount: true, printedAt: true },
      },
    },
    orderBy: { householdId: "asc" },
  });

  const rows: PurgeRow[] = records.map((r) => {
    const paid = r.registrationItems.some((it) => Number(it.amountPaid) > 0);
    const printed = r.registrationItems.some((it) => it.printCount > 0 || it.printedAt != null);
    const blocker = paid ? "有已收款項目，請先處理收款" : printed ? "有已列印項目" : null;
    return {
      ritualRecordId: r.id,
      householdId: r.householdId,
      householdName: r.household?.name ?? null,
      year: r.year,
      eligible: !blocker,
      blocker,
    };
  });

  const base: PurgeArchivedReport = { ok: true, commit, year: opts.year ?? null, rows, removed: 0 };
  if (!commit) return base;

  let removed = 0;
  for (const row of rows) {
    if (!row.eligible) continue;
    const res = await deleteUniversalSalvationRecord(row.householdId, row.year, opts.operatorName ?? "系統：收回已封存家戶的普渡報名");
    row.removed = res.ok;
    if (res.ok) removed += 1;
    else row.blocker = res.error;
  }
  return { ...base, removed };
}
