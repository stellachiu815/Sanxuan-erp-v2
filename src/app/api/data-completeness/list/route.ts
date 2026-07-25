import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listIncompleteRegistrations } from "@/lib/dataCompletenessSummary";

/**
 * V15R3：GET /api/data-completeness/list
 * 資料待補清單（純讀取）。篩選：year／activityType／missingField／memberName／householdId。
 * view 權限（READONLY 可看，但前端不顯示寫入操作）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const url = new URL(request.url);
  const yearRaw = url.searchParams.get("year");
  const rows = await listIncompleteRegistrations({
    year: yearRaw && Number.isInteger(Number(yearRaw)) ? Number(yearRaw) : undefined,
    activityType: url.searchParams.get("activityType") ?? undefined,
    missingField: url.searchParams.get("missingField") ?? undefined,
    memberName: url.searchParams.get("memberName") ?? undefined,
    householdId: url.searchParams.get("householdId") ?? undefined,
  });
  return NextResponse.json({ ok: true, rows });
}
