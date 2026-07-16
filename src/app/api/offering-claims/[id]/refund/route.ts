import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { refundOfferingClaim } from "@/lib/offeringClaims";

/**
 * POST /api/offering-claims/xxx/refund
 *   body: { "amount": 1500, "paidOn": "2026-07-16", "reason": "信眾要求退款",
 *           "kind": "REFUND"（或 "TRANSFER_OUT"）, "operatorName": "...", "relatedClaimId": "..." }
 * 需求「二十」：完成已收款認捐的退款/轉款流程，保存金額/日期/經手人/原因。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.reason !== "string") {
    return NextResponse.json({ error: "請填寫退款/轉款原因" }, { status: 400 });
  }

  const paidOn = typeof body.paidOn === "string" ? new Date(body.paidOn) : new Date();
  const result = await refundOfferingClaim(id, {
    amount: Number(body.amount),
    paidOn,
    kind: body.kind === "TRANSFER_OUT" ? "TRANSFER_OUT" : "REFUND",
    reason: body.reason,
    operatorName: typeof body.operatorName === "string" ? body.operatorName : null,
    relatedClaimId: typeof body.relatedClaimId === "string" ? body.relatedClaimId : null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
