import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { voidFinanceRecord } from "@/lib/financeCenter";

/** V22 作廢一筆流水帳（不刪除，資料保留）。body: { id, reason } */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "void");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  const id = body && typeof body.id === "string" ? body.id : "";
  const reason = body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!id) return NextResponse.json({ error: "缺少紀錄 id" }, { status: 400 });
  if (!reason) return NextResponse.json({ error: "作廢必須填寫原因" }, { status: 400 });

  const record = await voidFinanceRecord(id, reason, { id: op.id, name: op.name });
  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: id, action: "VOID", operatorId: op.id, reason },
  });
  return NextResponse.json({ ok: true, record });
}
