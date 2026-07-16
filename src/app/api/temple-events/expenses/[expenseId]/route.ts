import { NextResponse } from "next/server";
import { removeTempleEventExpense } from "@/lib/templeEvents";

/**
 * DELETE /api/temple-events/expenses/xxx
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ expenseId: string }> }) {
  const { expenseId } = await params;
  const result = await removeTempleEventExpense(expenseId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.data.id });
}
