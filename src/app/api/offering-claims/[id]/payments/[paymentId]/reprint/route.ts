import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { reprintOfferingReceipt } from "@/lib/offeringClaims";

/** POST /api/offering-claims/xxx/payments/xxx/reprint：需求「十四」補印收據，不得產生新應收款。 */
export async function POST(_request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const result = await reprintOfferingReceipt(paymentId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ paymentId: result.data.paymentId });
}
