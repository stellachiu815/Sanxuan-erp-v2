import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { correctFinanceRecord } from "@/lib/financeCenter";
import type { FinanceAccountT } from "@/lib/financePrisma";

/**
 * V22 更正：作廢原紀錄並新增一筆修正紀錄（correctsRecordId 指向原紀錄）。
 * body: { originalId, kind:"INCOME"|"EXPENSE", account, amount, category, occurredOn, description?, templeEventId? }
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "correct");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "請提供資料" }, { status: 400 });
  const originalId = typeof body.originalId === "string" ? body.originalId : "";
  const kind = body.kind === "INCOME" ? "INCOME" : body.kind === "EXPENSE" ? "EXPENSE" : null;
  const account = (body.account === "BANK" || body.account === "CASH" ? body.account : null) as FinanceAccountT | null;
  const amount = Number(body.amount);
  const category = typeof body.category === "string" ? body.category.trim() : "";
  const occurredOn = typeof body.occurredOn === "string" ? body.occurredOn : "";
  const description = typeof body.description === "string" ? body.description : null;
  const templeEventId = typeof body.templeEventId === "string" && body.templeEventId ? body.templeEventId : null;

  if (!originalId) return NextResponse.json({ error: "缺少原紀錄 id" }, { status: 400 });
  if (!kind || !account || !(amount > 0) || !category || !/^\d{4}-\d{2}-\d{2}$/.test(occurredOn)) {
    return NextResponse.json({ error: "更正資料不完整" }, { status: 400 });
  }

  const result = await correctFinanceRecord(
    originalId,
    { type: kind, account, amount, category, occurredOn, description, templeEventId: kind === "EXPENSE" ? templeEventId : null, operator: { id: op.id, name: op.name } },
    { id: op.id, name: op.name }
  );
  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: originalId, action: "UPDATE", operatorId: op.id, reason: "更正（新增修正紀錄）", afterData: { correctedBy: result.created.id } },
  });
  return NextResponse.json({ ok: true, ...result });
}
