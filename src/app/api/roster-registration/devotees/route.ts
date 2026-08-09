import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { quickRegSearchDevotees } from "@/lib/quickRegistration";

/**
 * 名單型報名：既有信眾查詢（供快速報名「帶既有信眾」用）。重用 quickRegSearchDevotees。
 * GET /api/roster-registration/devotees?q=王
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const q = request.nextUrl.searchParams.get("q") ?? "";
  const results = await quickRegSearchDevotees(q);
  return NextResponse.json({ results });
}
