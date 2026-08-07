import { prisma } from "@/lib/prisma";
import { validateForConfirm, confirmRegistration } from "@/lib/activityRegistration";

/**
 * V38 一鍵批次確認：把某年度「有內容但還停在草稿」的普渡報名一次確認轉正式。
 *
 * 用途：匯入／現場報名建立後停在草稿的，核對好後一次全部轉正式（狀態→CONFIRMED）。
 * 只確認「通過確認驗證」的（有牌位或白米/贊普等任一項目＋有報名成員）；缺內容的略過並說明。
 * 已收款／已列印不影響確認。已封存家戶的排除。commit=false 預覽、true 才執行。
 */

export type BatchConfirmRow = {
  ritualRecordId: string;
  householdId: string;
  householdName: string | null;
  canConfirm: boolean;
  reason: string | null;
  confirmed?: boolean;
};
export type BatchConfirmReport = {
  ok: boolean;
  commit: boolean;
  year: number;
  totalDraft: number;
  confirmable: number;
  confirmed: number;
  rows: BatchConfirmRow[];
};

export async function batchConfirmUniversalSalvation(
  year: number,
  opts: { commit: boolean; operatorName: string | null }
): Promise<BatchConfirmReport> {
  const commit = !!opts.commit;
  const records = await prisma.ritualRecord.findMany({
    where: {
      activityType: "UNIVERSAL_SALVATION",
      year,
      status: "DRAFT",
      deletedAt: null,
      household: { deletedAt: null },
    },
    select: { id: true, householdId: true, household: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });

  const rows: BatchConfirmRow[] = [];
  let confirmed = 0;
  for (const r of records) {
    const v = await validateForConfirm(r.id);
    const row: BatchConfirmRow = {
      ritualRecordId: r.id,
      householdId: r.householdId,
      householdName: r.household?.name ?? null,
      canConfirm: v.ok,
      reason: v.ok ? null : v.reasons.join("；"),
    };
    if (commit && v.ok) {
      const c = await confirmRegistration(r.id, opts.operatorName);
      row.confirmed = c.ok;
      if (c.ok) confirmed += 1;
      else row.reason = c.error;
    }
    rows.push(row);
  }

  return {
    ok: true,
    commit,
    year,
    totalDraft: records.length,
    confirmable: rows.filter((x) => x.canConfirm).length,
    confirmed,
    rows,
  };
}
