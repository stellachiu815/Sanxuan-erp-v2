import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { recordOfferingPayment } from "@/lib/offeringClaims";

/**
 * POST /api/offering-claims/xxx/payments
 *   body: { "amount": 800, "paidOn": "2026-07-16", "method": "現金",
 *           "collectedByName": "...", "receiptNumber": "R00123", "note": "..." }
 * 需求「十三」：每次收款獨立保存，支援分次付款，不會只存累計金額。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.amount !== "number") {
    return NextResponse.json({ error: "請提供正確的收款金額" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const paidOn = typeof body.paidOn === "string" ? new Date(body.paidOn) : new Date();
  const result = await recordOfferingPayment(
    id,
    {
      amount: body.amount,
      paidOn,
      method: typeof body.method === "string" ? body.method : null,
      collectedByName: typeof body.collectedByName === "string" ? body.collectedByName : operatorName,
      receiptNumber: typeof body.receiptNumber === "string" ? body.receiptNumber : null,
      note: typeof body.note === "string" ? body.note : null,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ paymentId: result.data.paymentId }, { status: 201 });
}
