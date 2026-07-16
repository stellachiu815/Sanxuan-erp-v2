import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAllocationAdjustment } from "@/lib/collectionCenter";

/**
 * POST /api/collection-center/allocations/xxx/adjustments
 *   body: { adjustmentType: "REFUND"|"TRANSFER_TO_OTHER"|"RETAIN_AS_OVERPAYMENT",
 *           amount, reason, operatorName?, approvedByName?,
 *           targetSourceType?, targetSourceId? }
 * 需求「退款/轉款」前三個選項（分配層級）：退款／轉款到其他應收項目／
 * 保留為溢收。第四個選項「作廢」是整筆交易層級，見
 * /api/collection-center/payments/[id]/void。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請提供調整資料" }, { status: 400 });
  }
  if (!["REFUND", "TRANSFER_TO_OTHER", "RETAIN_AS_OVERPAYMENT"].includes(body.adjustmentType)) {
    return NextResponse.json({ error: "請選擇正確的調整類型" }, { status: 400 });
  }
  if (typeof body.amount !== "number" || typeof body.reason !== "string") {
    return NextResponse.json({ error: "請提供金額與原因" }, { status: 400 });
  }

  const result = await createAllocationAdjustment({
    allocationId: id,
    adjustmentType: body.adjustmentType,
    amount: body.amount,
    reason: body.reason,
    operatorName: typeof body.operatorName === "string" ? body.operatorName : null,
    approvedByName: typeof body.approvedByName === "string" ? body.approvedByName : null,
    targetSourceType: typeof body.targetSourceType === "string" ? body.targetSourceType : undefined,
    targetSourceId: typeof body.targetSourceId === "string" ? body.targetSourceId : undefined,
    acknowledgeReceiptImpact: body.acknowledgeReceiptImpact === true,
  });
  if (!result.ok) {
    // 需求「十四、退款與收據關係」：409 代表「需要使用者先確認收據影響」。
    return NextResponse.json({ error: result.error, receiptImpact: result.receiptImpact }, { status: result.status });
  }
  revalidatePath("/collection-center");
  revalidatePath("/offering-center");
  return NextResponse.json(result.data, { status: 201 });
}
