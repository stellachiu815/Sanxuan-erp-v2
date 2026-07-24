import { NextRequest, NextResponse } from "next/server";
import { listUniversalSalvationPrintGroups, type PrintCenterFilters } from "@/lib/additionalPrintItems";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V14.4 Part 3：普渡列印中心「以牌位分組」清單（每組含 TABLET／POCKET 列印物件狀態）。
 * 沿用既有 listPrintItemsForPrintCenter 查詢（同一份資料），只是分組投影供新 UI 顯示雙區塊。
 *
 * GET /api/universal-salvation/[year]/print-items/groups?householdId=&printName=
 * READONLY 可查看（view）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const sp = new URL(request.url).searchParams;
  const filters: PrintCenterFilters = {};
  const householdId = sp.get("householdId");
  const printName = sp.get("printName");
  if (householdId) filters.householdId = householdId;
  if (printName) filters.printName = printName;

  const groups = await listUniversalSalvationPrintGroups(year, filters);
  return NextResponse.json({ ok: true, year, groups, canPrint: check.operator.role !== "READONLY" });
}
