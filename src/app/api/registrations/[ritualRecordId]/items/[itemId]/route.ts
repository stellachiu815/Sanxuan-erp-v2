import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { removeRegisteredItem } from "@/lib/registrationItemRegistration";

/**
 * V14：移除（軟刪除）一個報名項目。
 * DELETE /api/registrations/[ritualRecordId]/items/[itemId]?operatorUserId=xxx
 *
 * 權限：manageParticipant（READONLY 一律 403）。已收款的項目不得直接移除。
 */
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string; itemId: string }> }
) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "manageParticipant");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }
  const { itemId } = await params;
  const result = await removeRegisteredItem(itemId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
