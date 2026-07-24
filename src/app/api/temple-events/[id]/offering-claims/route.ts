import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listOfferingClaims, createOfferingClaim } from "@/lib/offeringClaims";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V10.1「供品認捐中心」需求「三、新增認捐」。
 *
 * GET  /api/temple-events/xxx/offering-claims?status=ACTIVE&onlyUnpaid=1
 * POST /api/temple-events/xxx/offering-claims
 *   body: { "activityOfferingId": "xxx", "sponsorMemberId": "xxx", "quantity": 1,
 *           "floralSlotId": "xxx"（花果供品才需要）, "unitPrice": 1500, ... }
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sp = request.nextUrl.searchParams;
  const claims = await listOfferingClaims({
    activityId: id,
    activityOfferingId: sp.get("activityOfferingId") ?? undefined,
    offeringTypeId: sp.get("offeringTypeId") ?? undefined,
    status: (sp.get("status") as "ACTIVE" | "CANCELLED" | "REFUND_PENDING" | "REFUNDED" | null) ?? undefined,
    onlyUnpaid: sp.get("onlyUnpaid") === "1",
  });
  return NextResponse.json({ claims });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.activityOfferingId !== "string" || typeof body.sponsorMemberId !== "string") {
    return NextResponse.json({ error: "請提供 activityOfferingId 與 sponsorMemberId" }, { status: 400 });
  }

  const __op = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "createClaim");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const result = await createOfferingClaim(
    {
      activityOfferingId: body.activityOfferingId,
      sponsorMemberId: body.sponsorMemberId,
      floralSlotId: typeof body.floralSlotId === "string" ? body.floralSlotId : null,
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      unitPrice: typeof body.unitPrice === "number" ? body.unitPrice : undefined,
      expectedPaymentDate: typeof body.expectedPaymentDate === "string" ? new Date(body.expectedPaymentDate) : null,
      note: typeof body.note === "string" ? body.note : null,
      createdBy: operatorName,
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
