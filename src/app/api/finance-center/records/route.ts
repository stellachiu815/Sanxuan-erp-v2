import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { createIncome, createExpense } from "@/lib/financeCenter";
import type { FinanceAccountT } from "@/lib/financePrisma";

/**
 * V22 新增流水帳：收入（一般收入）或支出（一般/指定活動）。
 * body: { kind:"INCOME"|"EXPENSE", account:"BANK"|"CASH", amount, category, occurredOn, description?, templeEventId? }
 * FINANCE_CLERK 只能建立草稿（status=DRAFT）。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "createEntry");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "請提供資料" }, { status: 400 });

  const kind = body.kind === "INCOME" ? "INCOME" : body.kind === "EXPENSE" ? "EXPENSE" : null;
  const account = (body.account === "BANK" || body.account === "CASH" ? body.account : null) as FinanceAccountT | null;
  const amount = Number(body.amount);
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : "";
  const description = typeof body.description === "string" ? body.description : null;
  const templeEventId = typeof body.templeEventId === "string" && body.templeEventId ? body.templeEventId : null;

  if (!kind) return NextResponse.json({ error: "請指定收入或支出" }, { status: 400 });
  if (!account) return NextResponse.json({ error: "請指定帳戶（銀行/現金）" }, { status: 400 });
  if (!(amount > 0)) return NextResponse.json({ error: "金額必須大於 0" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "請輸入項目名稱" }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) return NextResponse.json({ error: "請提供正確日期" }, { status: 400 });

  const status = op.role === "FINANCE_CLERK" ? "DRAFT" : "CONFIRMED";
  const input = {
    account,
    amount,
    category,
    occurredOn,
    description,
    templeEventId: kind === "EXPENSE" ? templeEventId : null,
    operator: { id: op.id, name: op.name },
    status: status as "DRAFT" | "CONFIRMED",
  };
  const record = kind === "INCOME" ? await createIncome(input) : await createExpense(input);

  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: record.id, action: "CREATE", operatorId: op.id, afterData: { kind, account, amount, category, occurredOn, templeEventId, status } },
  });

  return NextResponse.json({ ok: true, record });
}
