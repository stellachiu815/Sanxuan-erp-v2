import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { removeRegisteredItem } from "@/lib/registrationItemRegistration";

/**
 * V14：移除（軟刪除／取消）一個報名項目。
 * DELETE /api/registrations/[ritualRecordId]/items/[itemId]
 *
 * ⚠️ V14.2 修正：operatorUserId 一律用共用的 readOperatorUserId(request)
 * （body-then-query）讀取。前端 fetchRegistration 對非 GET 一律把 operatorUserId
 * 放進 JSON body，這支之前只從 query string 讀 → 一律讀不到 → 401
 * 「找不到有效的操作人員身分」。與先前 batch registration 是同一類問題。
 *
 * 權限：manageParticipant（READONLY 一律 403）。已收款／已開收據／已列印的項目
 * 不得直接取消（由 removeRegisteredItem 回傳明確原因）。
 */
export const dynamic = "force-dynamic";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string; itemId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
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
