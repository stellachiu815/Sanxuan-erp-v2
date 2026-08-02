import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getUniversalSalvationRegistrationDetail } from "@/lib/universalSalvationDetail";

/**
 * V30.5：某筆中元普渡報名（RitualRecord）的完整報名明細（唯讀），供信眾詳情「活動」分頁展開。
 * GET /api/registrations/[ritualRecordId]/detail?operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const { ritualRecordId } = await params;
  const detail = await getUniversalSalvationRegistrationDetail(ritualRecordId);
  if (!detail) {
    return NextResponse.json({ error: "找不到這筆中元普渡報名" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, detail });
}
