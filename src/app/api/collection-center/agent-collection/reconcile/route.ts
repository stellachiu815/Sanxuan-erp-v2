import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAgentReconciliation } from "@/lib/collectionCenter";
import { assertCollectionPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

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
  // V14.3：代收對帳屬管理作業，僅 SUPER_ADMIN／ADMIN；對帳人用登入 session。
  const check = await assertCollectionPermissionForOperator(await readOperatorUserId(request), "reconcile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const result = await createAgentReconciliation({
    agentName: body.agentName,
    periodLabel: body.periodLabel,
    actualAmount: body.actualAmount,
    differenceReason: typeof body.differenceReason === "string" ? body.differenceReason : null,
    reconciledByName: check.operator.name,
    note: typeof body.note === "string" ? body.note : null,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/collection-center");
  return NextResponse.json(result.data, { status: 201 });
}
