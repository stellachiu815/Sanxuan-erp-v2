/**
 * 列出所有「待確認」的匯入列（家戶編號跟現有資料庫衝突、被擋下沒有匯入的列）。
 * 純查詢、唯讀，方便行政人員之後人工比對決定怎麼處理（本輪不提供覆蓋/合併功能）。
 */
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function GET() {
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
