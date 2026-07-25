import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getDataCompletenessSummary } from "@/lib/dataCompletenessSummary";

/**
 * V15R3：GET /api/data-completeness/summary
 * 首頁「資料待補」卡片彙總（純讀取；禁止任何寫入／補值／狀態變更）。view 權限（READONLY 可看）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const summary = await getDataCompletenessSummary();
  return NextResponse.json({ ok: true, summary });
}
