import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { createReconciliation } from "@/lib/financeCenter";
import type { FinanceAccountT } from "@/lib/financePrisma";

/**
 * V22 現金盤點／銀行對帳：記錄實際盤點金額，差額以 ADJUSTMENT 分錄修正（不直接改餘額）。
 * body: { account, countedAmount, occurredOn, note? }
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "reconcile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "請提供資料" }, { status: 400 });
  const account = (body.account === "BANK" || body.account === "CASH" ? body.account : null) as FinanceAccountT | null;
  const countedAmount = Number(body.countedAmount);
  const occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : "";
  const note = typeof body.note === "string" ? body.note : null;

  if (!account) return NextResponse.json({ error: "請指定盤點帳戶" }, { status: 400 });
  if (!Number.isFinite(countedAmount)) return NextResponse.json({ error: "請輸入盤點金額" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return NextResponse.json({ error: "請提供正確日期" }, { status: 400 });

  const result = await createReconciliation({ account, countedAmount, occurredOn, note, operator: { id: op.id, name: op.name } });
  await prisma.auditLog.create({
    data: { entityType: "FinanceReconciliation", entityId: result.reconciliationId, action: "CREATE", operatorId: op.id, afterData: { account, ...result } },
  });
  return NextResponse.json({ ok: true, ...result });
}
