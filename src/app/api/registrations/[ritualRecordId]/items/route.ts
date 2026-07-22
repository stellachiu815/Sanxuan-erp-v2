import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { listRegisteredItems } from "@/lib/registrationItemRegistration";

/**
 * V14：列出某筆報名（RitualRecord）底下已報名的項目。
 * GET /api/registrations/[ritualRecordId]/items?operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const { ritualRecordId } = await params;
  const items = await listRegisteredItems(ritualRecordId);
  return NextResponse.json({ ok: true, items });
}
