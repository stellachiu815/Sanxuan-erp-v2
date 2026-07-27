import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listPrintCenterItems, REGISTRATION_SOURCE_LABEL, type PrintCenterFilters } from "@/lib/printDocuments";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * V15R8：普渡列印中心「唯一入口」報名名單查詢（所有來源共用一份）。
 *
 * GET /api/print-center/items?year=115&itemKey=US_ANCESTOR&source=EXCEL_IMPORT&printStatus=UNPRINTED&q=王
 * 只回正式可列印資料（CONFIRMED）；純讀取。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const url = request.nextUrl;
  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : getCurrentRitualYear();
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const printStatusRaw = url.searchParams.get("printStatus");
  const printStatus: PrintCenterFilters["printStatus"] =
    printStatusRaw === "UNPRINTED" || printStatusRaw === "PRINTED" ? printStatusRaw : "ALL";

  const filters: PrintCenterFilters = {
    year,
    itemKey: url.searchParams.get("itemKey") || null,
    source: url.searchParams.get("source") || null,
    printStatus,
    q: url.searchParams.get("q") || null,
  };
  const items = await listPrintCenterItems(filters);
  return NextResponse.json({ ok: true, year, filters, items, sourceLabels: REGISTRATION_SOURCE_LABEL });
}
