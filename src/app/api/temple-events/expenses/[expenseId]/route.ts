import { NextResponse } from "next/server";
import { removeTempleEventExpense } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * DELETE /api/temple-events/expenses/xxx
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageExpenses");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const { expenseId } = await params;
  const result = await removeTempleEventExpense(expenseId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.data.id });
}
