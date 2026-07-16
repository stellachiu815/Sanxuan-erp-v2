import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { markNoReceiptRequired } from "@/lib/receipt";

/**
 * POST /api/receipt-center/allocations/xxx/mark-no-receipt-required
 *   body: { amount, reason, operatorUserId }
 * 需求「六」操作之一、指令「三、補齊『標記不需開立』權限」：標記不需開立
 * 是獨立於一般開立權限的操作，必須填寫原因、且僅授權人員（ADMIN／
 * SUPER_ADMIN）可以執行——實際的權限與身分驗證在
 * src/lib/receipt.ts markNoReceiptRequired() 裡完成（伺服器端真的查詢
 * User 資料表，不只是這裡檢查一次）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.amount !== "number") {
    return NextResponse.json({ error: "請提供金額" }, { status: 400 });
  }
  if (typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "請填寫標記不需開立的原因" }, { status: 400 });
  }
  if (typeof body.operatorUserId !== "string" || !body.operatorUserId) {
    return NextResponse.json({ error: "請提供操作人員身分" }, { status: 400 });
  }
  const result = await markNoReceiptRequired({
    allocationId: id,
    amount: body.amount,
    reason: body.reason,
    operatorUserId: body.operatorUserId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  return NextResponse.json(result.data, { status: 201 });
}
