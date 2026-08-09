import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

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

/**
 * 軟刪除一筆「民國 0 年」孤兒報名（整筆記錄＋其項目＋普渡牌位 entry 一併軟刪）。
 * 可從回收桶還原。**安全鎖：只允許刪除 year ≤ 0 的報名,永不誤刪正常年度。**
 */
export async function deleteZeroYearRegistration(
  ritualRecordId: string,
  operatorName?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const record = await prisma.ritualRecord.findUnique({ where: { id: ritualRecordId } });
  if (!record) return { ok: false, status: 404, error: "找不到這筆報名" };
  if (record.year > 0) return { ok: false, status: 400, error: "這不是民國 0 年報名，為安全起見不予刪除。" };
  if (record.deletedAt) return { ok: true };

  const stamp = operatorName ?? "系統：清除民國0年孤兒報名";
  await prisma.$transaction(async (tx) => {
    const after = await tx.ritualRecord.update({
      where: { id: ritualRecordId },
      data: { status: "CANCELLED", deletedAt: new Date(), deletedByName: stamp },
    });
    // 旗下報名項目一併取消＋軟刪（不再進待收款/列印/清單）。
    await tx.ritualRegistrationItem.updateMany({
      where: { ritualRecordId, deletedAt: null },
      data: { status: "CANCELLED", deletedAt: new Date(), deletedByName: stamp },
    });
    // 普渡牌位 entry 一併軟刪（若為普渡報名）。
    const detail = await tx.universalSalvationDetail.findUnique({ where: { ritualRecordId }, select: { id: true } });
    if (detail) {
      await tx.universalSalvationEntry.updateMany({
        where: { universalSalvationId: detail.id, deletedAt: null },
        data: { deletedAt: new Date(), deletedByName: stamp },
      });
    }
    // ⚠️ 關鍵：列印中心是讀「列印物件(AdditionalPrintItem)」，牌位／寶袋要一併軟刪，
    // 否則刪了報名、牌位卻還留在列印清單裡（范姓 64 應為 63、兩筆地址的成因）。
    // 民國 0 年皆 0 元、未收款，直接軟刪安全；可回收桶還原。
    await tx.additionalPrintItem.updateMany({
      where: { ritualRecordId, deletedAt: null },
      data: { deletedAt: new Date(), deletedByName: stamp },
    });
    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: ritualRecordId,
        action: "UPDATE",
        beforeData: record,
        afterData: after,
        operatorName,
        changeNote: "清除民國0年孤兒報名（軟刪除，可回收桶還原）",
      },
      tx
    );
  });
  return { ok: true };
}

/** 一次軟刪除所有「民國 0 年」孤兒報名。回實際刪除/失敗筆數。 */
export async function deleteAllZeroYearRegistrations(
  operatorName?: string | null
): Promise<{ ok: true; deleted: number; failed: number }> {
  const rows = await prisma.ritualRecord.findMany({ where: { year: { lte: 0 }, deletedAt: null }, select: { id: true } });
  let deleted = 0;
  let failed = 0;
  for (const r of rows) {
    const res = await deleteZeroYearRegistration(r.id, operatorName);
    if (res.ok) deleted++;
    else failed++;
  }
  return { ok: true, deleted, failed };
}
