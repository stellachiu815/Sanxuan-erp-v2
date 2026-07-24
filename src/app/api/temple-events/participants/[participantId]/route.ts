import { NextRequest, NextResponse } from "next/server";
import { removeGenericParticipant } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 移除一筆通用參加名單（軟性「取消」，見 src/lib/templeEvents.ts 說明：
 * 保留紀錄、狀態改為 CANCELLED，不會物理刪除）。
 *
 * DELETE /api/temple-events/participants/xxx
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ participantId: string }> }) {
  const { participantId } = await params;
  await request.json().catch(() => ({}));
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageParticipants");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await removeGenericParticipant(participantId, __op.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.data.id });
}
