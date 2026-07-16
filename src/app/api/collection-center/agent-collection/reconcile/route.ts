import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAgentReconciliation } from "@/lib/collectionCenter";

/**
 * POST /api/collection-center/agent-collection/reconcile
 *   body: { agentName, periodLabel, actualAmount, differenceReason?,
 *           reconciledByName?, note? }
 * 需求「代收對帳」：實際≠預期繳回金額時，必須填寫差異原因。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.agentName !== "string" || typeof body.periodLabel !== "string") {
    return NextResponse.json({ error: "請提供代收人與對帳期間" }, { status: 400 });
  }
  if (typeof body.actualAmount !== "number") {
    return NextResponse.json({ error: "請提供實際繳回金額" }, { status: 400 });
  }
  const result = await createAgentReconciliation({
    agentName: body.agentName,
    periodLabel: body.periodLabel,
    actualAmount: body.actualAmount,
    differenceReason: typeof body.differenceReason === "string" ? body.differenceReason : null,
    reconciledByName: typeof body.reconciledByName === "string" ? body.reconciledByName : null,
    note: typeof body.note === "string" ? body.note : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/collection-center");
  return NextResponse.json(result.data, { status: 201 });
}
