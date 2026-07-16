import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getOfferingClaim, updateOfferingClaim } from "@/lib/offeringClaims";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const claim = await getOfferingClaim(id);
  if (!claim) return NextResponse.json({ error: "找不到這筆認捐資料" }, { status: 404 });
  return NextResponse.json({ claim });
}

/**
 * PATCH /api/offering-claims/xxx
 *   body: { "unitPrice": 2000, "isWaived": false, "collectionNote": "已電話催收", ... }
 *   需求「二十一」：金額修改/免收都需要留下操作前後內容，changeReason 選填。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const changeReason = typeof body.changeReason === "string" ? body.changeReason : null;
  const result = await updateOfferingClaim(
    id,
    {
      unitPrice: body.unitPrice !== undefined ? (body.unitPrice === null ? null : Number(body.unitPrice)) : undefined,
      quantity: typeof body.quantity === "number" ? body.quantity : undefined,
      isWaived: typeof body.isWaived === "boolean" ? body.isWaived : undefined,
      expectedPaymentDate:
        body.expectedPaymentDate !== undefined
          ? body.expectedPaymentDate
            ? new Date(body.expectedPaymentDate)
            : null
          : undefined,
      collectionNote: typeof body.collectionNote === "string" ? body.collectionNote : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
    },
    operatorName,
    changeReason
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
