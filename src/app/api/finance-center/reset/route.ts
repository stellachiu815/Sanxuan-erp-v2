import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertFinancePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { prisma } from "@/lib/prisma";
import { resetFinanceCenter } from "@/lib/financeCenter";

/**
 * V38 清空財務中心並重設期初（僅最高管理員＝manageOpening 權限）。
 * body: { bankOpening, cashOpening, confirm:true }
 * ⚠️ 硬刪除所有 FinanceRecord，不可還原；只供初次設定／測試後重來。
 */
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const userId = await readOperatorUserId(request);
  const check = await assertFinancePermissionForOperator(userId, "manageOpening");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const op = check.operator;

  const body = (await readJsonBody(request)) as Record<string, unknown> | null;
  if (!body || body.confirm !== true) return NextResponse.json({ error: "請確認後再執行（清空不可還原）" }, { status: 400 });

  const bankOpening = Number(body.bankOpening);
  const cashOpening = Number(body.cashOpening);
  if (!Number.isFinite(bankOpening) || bankOpening < 0) return NextResponse.json({ error: "銀行期初金額不正確" }, { status: 400 });
  if (!Number.isFinite(cashOpening) || cashOpening < 0) return NextResponse.json({ error: "現金期初金額不正確" }, { status: 400 });

  const res = await resetFinanceCenter({ bankOpening, cashOpening, operator: { id: op.id, name: op.name } });
  await prisma.auditLog.create({
    data: { entityType: "FinanceRecord", entityId: "RESET", action: "VOID", operatorId: op.id, afterData: { deleted: res.deleted, bankOpening, cashOpening } },
  });
  return NextResponse.json({ ok: true, ...res });
}
