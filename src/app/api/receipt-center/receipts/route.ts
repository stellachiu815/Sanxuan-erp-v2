import { NextRequest, NextResponse } from "next/server";
import { listReceipts } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * GET /api/receipt-center/receipts
 *   query: ?operatorUserId&receiptNumber&payerName&payerPhone&householdId&transactionNo
 *          &dateFrom&dateTo&amountFrom&amountTo&status&onlyReprinted&onlyReissued
 * 需求「已開立收據」「收據查詢」兩個頁籤共用同一支查詢（見交付報告畫面整合說明）。
 *
 * V11.1.1 新增：需要 ?operatorUserId=xxx，伺服器端真的驗證「查看收據」權限。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertReceiptPermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const rows = await listReceipts({
    receiptNumber: searchParams.get("receiptNumber") ?? undefined,
    payerName: searchParams.get("payerName") ?? undefined,
    payerPhone: searchParams.get("payerPhone") ?? undefined,
    householdId: searchParams.get("householdId") ?? undefined,
    transactionNo: searchParams.get("transactionNo") ?? undefined,
    dateFrom: searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : undefined,
    dateTo: searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : undefined,
    amountFrom: searchParams.get("amountFrom") ? Number(searchParams.get("amountFrom")) : undefined,
    amountTo: searchParams.get("amountTo") ? Number(searchParams.get("amountTo")) : undefined,
    status: searchParams.get("status") ?? undefined,
    onlyReprinted: searchParams.get("onlyReprinted") === "1",
    onlyReissued: searchParams.get("onlyReissued") === "1",
  });
  return NextResponse.json({ rows });
}
