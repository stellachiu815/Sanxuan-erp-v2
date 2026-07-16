import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { reissueReceipt } from "@/lib/receipt";

/**
 * POST /api/receipt-center/receipts/xxx/reissue
 *   body: { payerName?, lineOverrides?: [{receiptLineId, itemName?, amount?}],
 *           reason, operatorUserId, approverUserId, isEmergencyOverride?, emergencyReason? }
 * 需求「十二、收據換開」：作廢原收據（狀態改為 REPLACED）、建立內容經過
 * 更正的新收據並取得新號碼，金額不得重複計算。
 *
 * V11.1.1 新增（對應指令「四」）：跟作廢一樣，operatorUserId／
 * approverUserId 都必填並經伺服器端真正驗證身分、角色與「操作人不可
 * 等於核准人」規則。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "換開請填寫原因" }, { status: 400 });
  }
  if (typeof body.operatorUserId !== "string" || !body.operatorUserId) {
    return NextResponse.json({ error: "請提供操作人員身分" }, { status: 400 });
  }
  if (typeof body.approverUserId !== "string" || !body.approverUserId) {
    return NextResponse.json({ error: "請提供核准人身分" }, { status: 400 });
  }
  const result = await reissueReceipt(id, {
    payerName: typeof body.payerName === "string" ? body.payerName : undefined,
    lineOverrides: Array.isArray(body.lineOverrides) ? body.lineOverrides : undefined,
    reason: body.reason,
    operatorUserId: body.operatorUserId,
    approverUserId: body.approverUserId,
    isEmergencyOverride: body.isEmergencyOverride === true,
    emergencyReason: typeof body.emergencyReason === "string" ? body.emergencyReason : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  return NextResponse.json(result.data, { status: 201 });
}
