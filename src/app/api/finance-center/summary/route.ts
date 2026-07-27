import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getFinanceHomeSummary } from "@/lib/financeCenter";

/** V22 財務首頁摘要：總結餘/銀行/現金/今日收入/支出/淨額/應收/已收。 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertFinancePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const summary = await getFinanceHomeSummary(new Date());
  return NextResponse.json({ ok: true, summary });
}
