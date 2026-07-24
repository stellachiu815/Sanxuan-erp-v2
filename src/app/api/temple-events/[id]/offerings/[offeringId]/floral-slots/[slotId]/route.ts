import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { setFloralSlotActive, setFloralSlotPriceOverride } from "@/lib/activityOfferings";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * PATCH /api/temple-events/xxx/offerings/xxx/floral-slots/xxx
 *   body: { "isActive": false } 或 { "priceOverride": 2000 }（需求「十一」：
 *   修改單筆花果供品價格，不影響其他 23 筆——這裡一次只更新一筆）。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; slotId: string }> }
) {
  const { id, slotId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageSettings");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  if (typeof body.isActive === "boolean") {
    const result = await setFloralSlotActive(slotId, body.isActive);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }
  if (body.priceOverride !== undefined) {
    const priceOverride = body.priceOverride === null ? null : Number(body.priceOverride);
    const result = await setFloralSlotPriceOverride(slotId, priceOverride);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center/floral");
  return NextResponse.json({ id: slotId });
}
