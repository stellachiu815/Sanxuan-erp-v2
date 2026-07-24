import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createMergedPaymentTransaction, listPaymentTransactions } from "@/lib/collectionCenter";
import { assertCollectionPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/collection-center/payments — 收款紀錄查詢
 *   query: ?isAgentCollected=1&agentName=xxx&status=COMPLETED
 *
 * POST /api/collection-center/payments — 建立一筆合併收款
 *   body: { paidOn, totalAmount, methodType, methodNote?, bankName?,
 *           bankAccountLast5?, checkNumber?, payerMemberId?, payerHouseholdId?,
 *           payerNameSnapshot, payerPhoneSnapshot?, collectedByName?,
 *           isAgentCollected?, agentName?, note?, operatorName?, idempotencyKey?,
 *           allocations: [{ sourceType, sourceId, amount, note? }, ...] }
 * 需求「合併收款」：一次真實收款事件只建立一筆 PaymentTransaction，底下
 * 可能有多筆 PaymentAllocation（例如龜3000+花果1500+燈600+油香2000=7100）。
 *
 * `idempotencyKey`（需求「九、重複送出防護」）：畫面在使用者按下確認收款的
 * 當下產生一組隨機值，同一次送出（連點兩下／網路重送）都帶同一組值；伺服器
 * 端與資料庫會確保相同的 idempotencyKey 只會產生一筆真正的收款交易，見
 * `src/lib/collectionCenter.ts` 的 `createMergedPaymentTransaction()`。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const rows = await listPaymentTransactions({
    isAgentCollected: searchParams.has("isAgentCollected") ? searchParams.get("isAgentCollected") === "1" : undefined,
    agentName: searchParams.get("agentName") ?? undefined,
    agentRemittanceStatus: searchParams.get("agentRemittanceStatus") ?? undefined,
    status: searchParams.get("status") ?? undefined,
  });
  return NextResponse.json({ rows });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請提供收款資料" }, { status: 400 });
  }
  if (typeof body.totalAmount !== "number" || !Array.isArray(body.allocations)) {
    return NextResponse.json({ error: "請提供收款總額與分配項目" }, { status: 400 });
  }
  if (typeof body.payerNameSnapshot !== "string" || !body.payerNameSnapshot.trim()) {
    return NextResponse.json({ error: "請提供付款人姓名" }, { status: 400 });
  }
  if (typeof body.methodType !== "string") {
    return NextResponse.json({ error: "請選擇收款方式" }, { status: 400 });
  }

  // V14.3：真實金流——一律以登入 session 為操作人，忽略前端送的 operatorName。
  const check = await assertCollectionPermissionForOperator(
    await readOperatorUserId(request),
    "recordPayment"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const operatorName = check.operator.name;
  const paidOn = typeof body.paidOn === "string" ? new Date(body.paidOn) : new Date();

  const result = await createMergedPaymentTransaction(
    {
      paidOn,
      totalAmount: body.totalAmount,
      methodType: body.methodType,
      methodNote: typeof body.methodNote === "string" ? body.methodNote : null,
      bankName: typeof body.bankName === "string" ? body.bankName : null,
      bankAccountLast5: typeof body.bankAccountLast5 === "string" ? body.bankAccountLast5 : null,
      checkNumber: typeof body.checkNumber === "string" ? body.checkNumber : null,
      payerMemberId: typeof body.payerMemberId === "string" ? body.payerMemberId : null,
      payerHouseholdId: typeof body.payerHouseholdId === "string" ? body.payerHouseholdId : null,
      payerNameSnapshot: body.payerNameSnapshot,
      payerPhoneSnapshot: typeof body.payerPhoneSnapshot === "string" ? body.payerPhoneSnapshot : null,
      collectedByName: typeof body.collectedByName === "string" ? body.collectedByName : operatorName,
      isAgentCollected: body.isAgentCollected === true,
      agentName: typeof body.agentName === "string" ? body.agentName : null,
      note: typeof body.note === "string" ? body.note : null,
      createdByName: operatorName,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      allocations: body.allocations.map((a: { sourceType: string; sourceId: string; amount: number; note?: string }) => ({
        sourceType: a.sourceType,
        sourceId: a.sourceId,
        amount: a.amount,
        note: a.note ?? null,
      })),
    },
    operatorName
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/collection-center");
  revalidatePath("/offering-center");
  return NextResponse.json(result.data, { status: 201 });
}
