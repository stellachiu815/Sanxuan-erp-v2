import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { toggleChecklistItem } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 活動 Checklist（需求「十一」）。
 *
 * GET   /api/temple-events/xxx/checklist
 * PATCH /api/temple-events/xxx/checklist
 *   body: { "itemId": "xxx", "isDone": true, "operatorName": "操作人姓名" }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const items = await prisma.templeEventChecklistItem.findMany({
    where: { templeEventId: id },
    orderBy: { sortOrder: "asc" },
  });
  return NextResponse.json({ items });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.itemId !== "string") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "update");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await toggleChecklistItem(body.itemId, Boolean(body.isDone), __op.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);

  return NextResponse.json({ id: result.data.id });
}
