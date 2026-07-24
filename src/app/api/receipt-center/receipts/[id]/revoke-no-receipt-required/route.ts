import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { revokeNoReceiptRequired } from "@/lib/receipt";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/receipt-center/receipts/xxx/revoke-no-receipt-required
 *   body: { reason, operatorUserId }
 * 指令「三、補齊『標記不需開立』權限」：允許授權人員撤銷標記，撤銷後這筆
 * 收款重新回到待開立收據清單。權限與身分驗證在
 * src/lib/receipt.ts revokeNoReceiptRequired() 裡完成。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "請填寫撤銷原因" }, { status: 400 });
  }
  const operatorUserId = await readOperatorUserId(request);
  if (!operatorUserId) {
    return NextResponse.json({ error: "尚未登入或帳號已停用，請重新登入" }, { status: 401 });
  }
  const result = await revokeNoReceiptRequired(id, {
    reason: body.reason,
    operatorUserId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  revalidatePath(`/receipt-center/receipts/${id}`);
  return NextResponse.json(result.data);
}
