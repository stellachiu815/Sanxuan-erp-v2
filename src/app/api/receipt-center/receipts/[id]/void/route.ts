import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { voidReceipt } from "@/lib/receipt";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/receipt-center/receipts/xxx/void
 *   body: { reason, operatorUserId, approverUserId, isEmergencyOverride?, emergencyReason? }
 * 需求「十一、收據作廢」：只改變收據自己的狀態，不觸碰收款/退款。
 *
 * V11.1.1 新增（對應指令「四、補齊收據作廢與換開的核准控制」）：
 * operatorUserId／approverUserId 都必填，且伺服器端會真的查詢這兩個使用者
 * 的身分、角色，並驗證「操作人不可等於核准人」（除非最高管理員以
 * isEmergencyOverride+emergencyReason 執行緊急處理）——實際驗證邏輯在
 * src/lib/receipt.ts voidReceipt() 裡完成。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "作廢請填寫原因" }, { status: 400 });
  }
  // V14.3：操作人一律以登入 session 為準（voidReceipt 內部仍會查證角色）。
  const operatorUserId = await readOperatorUserId(request);
  if (!operatorUserId) {
    return NextResponse.json({ error: "尚未登入或帳號已停用，請重新登入" }, { status: 401 });
  }
  if (typeof body.approverUserId !== "string" || !body.approverUserId) {
    return NextResponse.json({ error: "請提供核准人身分" }, { status: 400 });
  }
  const result = await voidReceipt(id, {
    reason: body.reason,
    operatorUserId,
    approverUserId: body.approverUserId,
    isEmergencyOverride: body.isEmergencyOverride === true,
    emergencyReason: typeof body.emergencyReason === "string" ? body.emergencyReason : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  return NextResponse.json(result.data);
}
