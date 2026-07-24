import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { addTempleEventExpense, listTempleEventExpenses } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 活動支出（需求「四」✓建立支出——這是活動中心內建的簡易支出容器，跟
 * 尚未開發的財務流水帳模組分開，見 schema TempleEventExpense 註解）。
 *
 * GET  /api/temple-events/xxx/expenses
 * POST /api/temple-events/xxx/expenses
 *   body: { "category": "印刷費", "amount": 3000, "occurredOn": "2026-07-16", "description": "備註" }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const expenses = await listTempleEventExpenses(id);
  return NextResponse.json({ expenses });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const occurredOn = typeof body.occurredOn === "string" ? new Date(body.occurredOn) : null;
  if (!occurredOn || Number.isNaN(occurredOn.getTime())) {
    return NextResponse.json({ error: "請提供正確的支出日期" }, { status: 400 });
  }
  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageExpenses");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await addTempleEventExpense(id, {
    category: typeof body.category === "string" ? body.category : null,
    amount: Number(body.amount),
    occurredOn,
    description: typeof body.description === "string" ? body.description : null,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
