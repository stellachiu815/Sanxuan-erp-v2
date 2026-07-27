import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getFinanceReport, resolveReportRange } from "@/lib/financeCenter";

/**
 * V22 財務報表（月／年／自訂）＝匯出共用查詢來源。
 * query: mode=month&rocYear=115&month=8 | mode=year&rocYear=115 | mode=custom&from=..&to=..
 * 區間解析函式 resolveReportRange 置於 @/lib/financeCenter（單一來源，route.ts 不得匯出自訂函式）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertFinancePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const range = resolveReportRange(request.nextUrl.searchParams);
  if (!range) return NextResponse.json({ error: "報表區間參數錯誤" }, { status: 400 });
  const report = await getFinanceReport(range.from, range.to, range.label);
  return NextResponse.json({ ok: true, report });
}
