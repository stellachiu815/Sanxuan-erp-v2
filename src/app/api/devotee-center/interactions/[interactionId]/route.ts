import { NextRequest, NextResponse } from "next/server";
import { updateDevoteeInteraction, deleteDevoteeInteraction, DEVOTEE_INTERACTION_TYPES } from "@/lib/devoteeInteractions";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * PATCH /api/devotee-center/interactions/xxx
 *   body: { operatorUserId, interactionType?, occurredAt?, content?, followUp?, nextContactDate? }
 * 對應指令「九」：修改互動紀錄（manageInteractions，SUPER_ADMIN 專屬）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ interactionId: string }> }) {
  const { interactionId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  if (body.interactionType !== undefined && !DEVOTEE_INTERACTION_TYPES.includes(body.interactionType)) {
    return NextResponse.json({ error: "互動類型不正確" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "manageInteractions");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const interaction = await updateDevoteeInteraction(
      interactionId,
      {
        interactionType: body.interactionType ?? undefined,
        occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
        content: typeof body.content === "string" ? body.content : undefined,
        followUp: body.followUp !== undefined ? (typeof body.followUp === "string" ? body.followUp : null) : undefined,
        nextContactDate: body.nextContactDate !== undefined ? (body.nextContactDate ? new Date(body.nextContactDate) : null) : undefined,
      },
      check.operator.name
    );
    return NextResponse.json({ interaction });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "修改互動紀錄失敗" }, { status: 400 });
  }
}

/**
 * DELETE /api/devotee-center/interactions/xxx
 *   body: { operatorUserId, reason }
 * 對應指令「九」：軟刪除，必須說明原因，保留稽核紀錄（manageInteractions，
 * SUPER_ADMIN 專屬）。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ interactionId: string }> }) {
  const { interactionId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "刪除互動紀錄必須說明原因" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "manageInteractions");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const interaction = await deleteDevoteeInteraction(interactionId, body.reason, check.operator.name);
    return NextResponse.json({ interaction });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "刪除互動紀錄失敗" }, { status: 400 });
  }
}
