import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { buildItemRoster, validateRosterForPrint } from "@/lib/printDocuments";

/**
 * V14：列印管理－某報名項目某年度的報名總名單（一鍵）。
 * GET /api/print-center/rosters/[itemKey]/[year]?operatorUserId=xxx
 *
 * 只列 CONFIRMED（草稿不列印）。權限：view。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemKey: string; year: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const { itemKey, year } = await params;
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }
  const roster = await buildItemRoster(itemKey, yearNum, false);
  if (!roster) {
    return NextResponse.json({ error: "找不到這個報名項目" }, { status: 404 });
  }
  // V21 列印預檢（只讀）：正式列印前檢查每列必要欄位；有缺漏時畫面提示、不直接列印。
  const preflight = validateRosterForPrint(itemKey, roster.rows);
  return NextResponse.json({ ok: true, roster, preflight });
}
