import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { createTransfer } from "@/lib/financeCenter";
import type { FinanceAccountT } from "@/lib/financePrisma";

/**
 * V22 資金轉移：現金↔銀行。不計收入/支出，只改帳戶餘額。
 * body: { fromAccount, toAccount, amount, occurredOn, description? }
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "transfer");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "請提供資料" }, { status: 400 });
  const fromAccount = (body.fromAccount === "BANK" || body.fromAccount === "CASH" ? body.fromAccount : null) as FinanceAccountT | null;
  const toAccount = (body.toAccount === "BANK" || body.toAccount === "CASH" ? body.toAccount : null) as FinanceAccountT | null;
  const amount = Number(body.amount);
  const occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : "";
  const description = typeof body.description === "string" ? body.description : null;

  if (!fromAccount || !toAccount) return NextResponse.json({ error: "請指定轉出與轉入帳戶" }, { status: 400 });
  if (fromAccount === toAccount) return NextResponse.json({ error: "轉出與轉入帳戶不可相同" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "金額必須大於 0" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return NextResponse.json({ error: "請提供正確日期" }, { status: 400 });

  const result = await createTransfer({ fromAccount, toAccount, amount, occurredOn, description, operator: { id: op.id, name: op.name } });
  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: result.transferGroupId, action: "CREATE", operatorId: op.id, afterData: { fromAccount, toAccount, amount, occurredOn } },
  });
  return NextResponse.json({ ok: true, ...result });
}
