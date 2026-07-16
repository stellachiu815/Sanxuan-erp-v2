import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateActivityOffering, removeActivityOffering } from "@/lib/activityOfferings";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offeringId: string }> }
) {
  const { id, offeringId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const result = await updateActivityOffering(
    offeringId,
    {
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      price: typeof body.price === "number" ? body.price : undefined,
      useDefaultPrice: typeof body.useDefaultPrice === "boolean" ? body.useDefaultPrice : undefined,
      allowPriceOverride: typeof body.allowPriceOverride === "boolean" ? body.allowPriceOverride : undefined,
      hasLimitedQuantity: typeof body.hasLimitedQuantity === "boolean" ? body.hasLimitedQuantity : undefined,
      isChargeable: typeof body.isChargeable === "boolean" ? body.isChargeable : undefined,
      claimMode: body.claimMode ?? undefined,
      claimStartDate: body.claimStartDate !== undefined ? (body.claimStartDate ? new Date(body.claimStartDate) : null) : undefined,
      claimEndDate: body.claimEndDate !== undefined ? (body.claimEndDate ? new Date(body.claimEndDate) : null) : undefined,
      status: body.status ?? undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offeringId: string }> }
) {
  const { id, offeringId } = await params;
  const operatorName = request.nextUrl.searchParams.get("operatorName");
  const result = await removeActivityOffering(offeringId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center");
  return NextResponse.json({ ok: true });
}
