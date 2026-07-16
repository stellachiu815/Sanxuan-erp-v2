import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updateOfferingType } from "@/lib/offeringTypes";

/**
 * PATCH /api/offering-types/xxx
 *   body: 任何 OfferingTypeInput 欄位的部分更新，含 isActive（停用/啟用）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const result = await updateOfferingType(
    id,
    {
      name: typeof body.name === "string" ? body.name : undefined,
      category: typeof body.category === "string" ? body.category : undefined,
      behaviorKind: body.behaviorKind ?? undefined,
      unit: body.unit ?? undefined,
      isChargeable: typeof body.isChargeable === "boolean" ? body.isChargeable : undefined,
      hasLimitedQuantity: typeof body.hasLimitedQuantity === "boolean" ? body.hasLimitedQuantity : undefined,
      defaultQuantity: typeof body.defaultQuantity === "number" ? body.defaultQuantity : undefined,
      defaultPrice: typeof body.defaultPrice === "number" ? body.defaultPrice : undefined,
      allowPriceOverride: typeof body.allowPriceOverride === "boolean" ? body.allowPriceOverride : undefined,
      allowDuplicateClaim: typeof body.allowDuplicateClaim === "boolean" ? body.allowDuplicateClaim : undefined,
      claimMode: body.claimMode ?? undefined,
      sortOrder: typeof body.sortOrder === "number" ? body.sortOrder : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/offering-center/settings");
  return NextResponse.json({ id: result.data.id });
}
