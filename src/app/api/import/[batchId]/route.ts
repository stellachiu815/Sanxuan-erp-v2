/**
 * 查詢單一匯入批次目前的狀態與每一列結果。
 * 讓「確認匯入」後重新整理頁面，還是能看到這個批次的結果（不會因為重新整理就消失）。
 *
 * V11.3 補上原本沒有的權限管控（見 manageDataImport 說明）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ batchId: string }> }
) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch) {
    return NextResponse.json({ error: "找不到這個匯入批次" }, { status: 404 });
  }
  return NextResponse.json({
    batchId: batch.id,
    fileName: batch.fileName,
    status: batch.status,
    summary: {
      total: batch.totalRows,
      ok: batch.okCount,
      error: batch.errorCount,
      duplicatePending: batch.duplicateCount,
      imported: batch.importedRowCount,
    },
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
    rows: batch.rows.map((r) => ({
      rowNumber: r.rowNumber,
      householdId: r.householdId,
      memberName: r.memberName,
      status: r.status,
      errors: r.errors,
      warnings: r.warnings,
    })),
  });
}
