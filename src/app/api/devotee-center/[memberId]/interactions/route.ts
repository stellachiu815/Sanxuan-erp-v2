import { NextRequest, NextResponse } from "next/server";
import { listDevoteeInteractions, createDevoteeInteraction, DEVOTEE_INTERACTION_TYPES } from "@/lib/devoteeInteractions";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/devotee-center/xxx/interactions?operatorUserId=xxx&includeDeleted=1
 * 對應指令「九、互動紀錄」：預設不含已軟刪除的紀錄。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const interactions = await listDevoteeInteractions(memberId, searchParams.get("includeDeleted") === "1");
  return NextResponse.json({ interactions });
}

/**
 * POST /api/devotee-center/xxx/interactions
 *   body: { operatorUserId, interactionType, occurredAt, content, followUp?, nextContactDate? }
 * 對應指令「九」：SUPER_ADMIN + ADMIN 可新增互動紀錄（createInteraction）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  if (!DEVOTEE_INTERACTION_TYPES.includes(body.interactionType)) {
    return NextResponse.json({ error: "互動類型不正確" }, { status: 400 });
  }
  if (typeof body.content !== "string" || !body.content.trim()) {
    return NextResponse.json({ error: "請填寫互動內容" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "createInteraction");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const interaction = await createDevoteeInteraction(
    {
      memberId,
      interactionType: body.interactionType,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date(),
      content: body.content,
      followUp: typeof body.followUp === "string" ? body.followUp : null,
      nextContactDate: body.nextContactDate ? new Date(body.nextContactDate) : null,
    },
    check.operator.name
  );

  return NextResponse.json({ interaction }, { status: 201 });
}
