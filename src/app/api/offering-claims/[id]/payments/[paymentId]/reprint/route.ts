import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { reprintOfferingReceipt } from "@/lib/offeringClaims";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/** POST /api/offering-claims/xxx/payments/xxx/reprint：需求「十四」補印收據，不得產生新應收款。 */
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const __op = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "recordPayment");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const { paymentId } = await params;
  const result = await reprintOfferingReceipt(paymentId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ paymentId: result.data.paymentId });
}
