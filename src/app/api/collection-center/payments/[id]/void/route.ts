import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { voidPaymentTransaction } from "@/lib/collectionCenter";

/**
 * POST /api/collection-center/payments/xxx/void
 *   body: { reason, approvedByName, operatorName? }
 * 需求「退款/轉款」第四選項：整筆收款登錄錯誤時作廢（不是刪除），沖銷底下
 * 所有分配的金額，並保留完整作廢紀錄。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || typeof body.approvedByName !== "string") {
    return NextResponse.json({ error: "作廢需要填寫原因與核准人" }, { status: 400 });
  }
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const acknowledgeReceiptImpact = body.acknowledgeReceiptImpact === true;
  const result = await voidPaymentTransaction(id, body.reason, operatorName, body.approvedByName, acknowledgeReceiptImpact);
  if (!result.ok) {
    // 需求「十四、退款與收據關係」：409 代表「需要使用者先確認收據影響」，
    // 把 receiptImpact 一併回傳給前端顯示提示，不是單純的錯誤訊息。
    return NextResponse.json({ error: result.error, receiptImpact: result.receiptImpact }, { status: result.status });
  }
  revalidatePath("/collection-center");
  revalidatePath("/offering-center");
  return NextResponse.json(result.data);
}
