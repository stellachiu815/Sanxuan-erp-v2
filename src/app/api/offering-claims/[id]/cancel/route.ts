import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cancelOfferingClaim } from "@/lib/offeringClaims";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/offering-claims/xxx/cancel
 * 需求「二十」：尚未收款直接取消並釋出名額；已收款則轉為「待退款/轉款」，
 * 需要再呼叫 /refund 完成流程才會真正結束。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const reason = typeof body?.reason === "string" ? body.reason : null;
  // V14.3：取消認捐僅 SUPER_ADMIN／ADMIN；操作人以登入 session 為準。
  const check = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "cancelClaim");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await cancelOfferingClaim(id, check.operator.name, reason);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id, status: result.data.status });
}
