import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { batchImportFinance, type BatchFinanceRow } from "@/lib/financeCenter";
import type { FinanceAccountT } from "@/lib/financePrisma";

/**
 * V38 批次記帳：一次貼上多筆分錄。
 * body: { rows: [{ occurredOn, kind:"INCOME"|"EXPENSE", account?:"BANK"|"CASH", category, amount, description? }] }
 * 權限＝createEntry。account 預設 CASH。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "createEntry");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as { rows?: unknown } | null;
  const raw = Array.isArray(body?.rows) ? body!.rows : [];
  if (raw.length === 0) return NextResponse.json({ error: "沒有可匯入的資料" }, { status: 400 });

  const rows: BatchFinanceRow[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const kind = r.kind === "INCOME" ? "INCOME" : "EXPENSE";
    const account = (r.account === "BANK" ? "BANK" : "CASH") as FinanceAccountT;
    rows.push({
      occurredOn: typeof r.occurredOn === "string" ? r.occurredOn : "",
      kind,
      account,
      category: typeof r.category === "string" ? r.category : "其他",
      amount: Number(r.amount),
      description: typeof r.description === "string" ? r.description : null,
    });
  }

  const res = await batchImportFinance(rows, { id: op.id, name: op.name });
  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: "BATCH", action: "CREATE", operatorId: op.id, afterData: { created: res.created } },
  });
  return NextResponse.json({ ok: true, ...res });
}
