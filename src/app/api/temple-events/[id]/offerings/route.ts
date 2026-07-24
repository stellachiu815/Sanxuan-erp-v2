import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listActivityOfferings, addActivityOffering } from "@/lib/activityOfferings";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V10.1「供品認捐中心」需求「二、活動供品設定」。
 *
 * GET  /api/temple-events/xxx/offerings
 * POST /api/temple-events/xxx/offerings
 *   body: { "offeringTypeId": "xxx", "quantity": 6, "useDefaultPrice": true, ... }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const offerings = await listActivityOfferings(id);
  return NextResponse.json({ offerings });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.offeringTypeId !== "string") {
    return NextResponse.json({ error: "請提供 offeringTypeId" }, { status: 400 });
  }

  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageSettings");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const result = await addActivityOffering(
    id,
    {
      offeringTypeId: body.offeringTypeId,
      quantity: typeof body.quantity === "number" ? body.quantity : null,
      price: typeof body.price === "number" ? body.price : null,
      useDefaultPrice: typeof body.useDefaultPrice === "boolean" ? body.useDefaultPrice : undefined,
      allowPriceOverride: typeof body.allowPriceOverride === "boolean" ? body.allowPriceOverride : undefined,
      hasLimitedQuantity: typeof body.hasLimitedQuantity === "boolean" ? body.hasLimitedQuantity : undefined,
      isChargeable: typeof body.isChargeable === "boolean" ? body.isChargeable : undefined,
      claimMode: body.claimMode ?? undefined,
      claimStartDate: typeof body.claimStartDate === "string" ? new Date(body.claimStartDate) : null,
      claimEndDate: typeof body.claimEndDate === "string" ? new Date(body.claimEndDate) : null,
      note: typeof body.note === "string" ? body.note : null,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
