import { NextRequest, NextResponse } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { quickRegSearchDevotees } from "@/lib/quickRegistration";

/**
 * V38 現場快速報名：既有信眾查詢（供報名人欄位自動帶出既有資料）。
 * GET /api/quick-registration/devotees?q=王
 */
export async function GET(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "create");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = await quickRegSearchDevotees(q);
  return NextResponse.json({ results });
}
