import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { quickIssueReceipt, type QuickReceiptInput } from "@/lib/quickReceipt";
import { assertCollectionPermissionForOperator, assertReceiptPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 現場快速開感謝狀：一次完成「收款＋開收據」。POST /api/receipt-center/quick-issue
 * body: { payer:{existingMemberId?|name,address,phone}, donations:[{name,amount}],
 *         activityLines:[{sourceType,sourceId,amount,itemName}], methodType?, year, idempotencyKey? }
 * 回 { receiptId } 供前端直接跳列印。權限：需同時具收款(recordPayment)與開收據(issue)。
 */
export async function POST(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const payCheck = await assertCollectionPermissionForOperator(operatorUserId, "recordPayment");
  if (!payCheck.ok) return NextResponse.json({ error: payCheck.error }, { status: payCheck.status });
  const rcptCheck = await assertReceiptPermissionForOperator(operatorUserId, "issue");
  if (!rcptCheck.ok) return NextResponse.json({ error: rcptCheck.error }, { status: rcptCheck.status });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const b = body as Partial<QuickReceiptInput>;
  if (!b.payer || typeof b.payer !== "object") return NextResponse.json({ error: "缺少付款人" }, { status: 400 });
  if (typeof b.year !== "number") return NextResponse.json({ error: "缺少年度" }, { status: 400 });

  const res = await quickIssueReceipt(
    {
      payer: b.payer,
      donations: Array.isArray(b.donations) ? b.donations : [],
      activityLines: Array.isArray(b.activityLines) ? b.activityLines : [],
      methodType: b.methodType ?? "CASH",
      methodNote: b.methodNote ?? null,
      bankName: b.bankName ?? null,
      bankAccountLast5: b.bankAccountLast5 ?? null,
      checkNumber: b.checkNumber ?? null,
      year: b.year,
      idempotencyKey: b.idempotencyKey ?? null,
    },
    { id: payCheck.operator.id, name: payCheck.operator.name }
  );
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });

  revalidatePath("/collection-center");
  revalidatePath("/receipt-center");
  return NextResponse.json({ ok: true, receiptId: res.receiptId, receiptNumber: res.receiptNumber, totalAmount: res.totalAmount }, { status: 201 });
}
