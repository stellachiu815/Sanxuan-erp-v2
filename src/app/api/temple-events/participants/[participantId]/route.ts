import { NextRequest, NextResponse } from "next/server";
import { removeGenericParticipant } from "@/lib/templeEvents";

/**
 * 移除一筆通用參加名單（軟性「取消」，見 src/lib/templeEvents.ts 說明：
 * 保留紀錄、狀態改為 CANCELLED，不會物理刪除）。
 *
 * DELETE /api/temple-events/participants/xxx
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ participantId: string }> }) {
  const { participantId } = await params;
  const body = await request.json().catch(() => ({}));
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await removeGenericParticipant(participantId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.data.id });
}
