/**
 * 列出所有「待確認」的匯入列（家戶編號跟現有資料庫衝突、被擋下沒有匯入的列）。
 * 純查詢、唯讀，方便行政人員之後人工比對決定怎麼處理（本輪不提供覆蓋/合併功能）。
 *
 * V11.3 補上原本沒有的權限管控（見 manageDataImport 說明）。
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";

export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const rows = await prisma.importRow.findMany({
    where: { status: "DUPLICATE_PENDING" },
    include: { batch: { select: { fileName: true, createdAt: true } } },
    orderBy: [{ householdId: "asc" }, { rowNumber: "asc" }],
  });

  const householdIds = Array.from(new Set(rows.map((r) => r.householdId)));
  const existingHouseholds = householdIds.length
    ? await prisma.household.findMany({
        where: { id: { in: householdIds } },
        select: { id: true, name: true, contactName: true, phone: true, address: true },
      })
    : [];
  const existingById = new Map(existingHouseholds.map((h) => [h.id, h]));

  return NextResponse.json({
    rows: rows.map((r) => ({
      batchFileName: r.batch.fileName,
      batchCreatedAt: r.batch.createdAt,
      rowNumber: r.rowNumber,
      householdId: r.householdId,
      memberName: r.memberName,
      rawData: r.rawData,
      existingHousehold: existingById.get(r.householdId) ?? null,
    })),
  });
}
