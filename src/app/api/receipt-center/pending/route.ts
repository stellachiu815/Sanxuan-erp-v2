import { NextRequest, NextResponse } from "next/server";
import { listPendingReceiptAllocations } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/receipt-center/pending
 *   query: ?operatorUserId&dateFrom&dateTo&payerName&payerPhone&householdId
 *          &transactionNo&sourceType&methodType&collectedByName&receiptStatus
 * 需求「六、待開立收據」：已收款但尚未完整開立收據的分配項目清單。
 *
 * V11.1.1 新增：需要 ?operatorUserId=xxx，伺服器端真的驗證「查看收據」權限。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertReceiptPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const rows = await listPendingReceiptAllocations({
    dateFrom: searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : undefined,
    dateTo: searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : undefined,
    payerName: searchParams.get("payerName") ?? undefined,
    payerPhone: searchParams.get("payerPhone") ?? undefined,
    householdId: searchParams.get("householdId") ?? undefined,
    transactionNo: searchParams.get("transactionNo") ?? undefined,
    sourceType: searchParams.get("sourceType") ?? undefined,
    methodType: searchParams.get("methodType") ?? undefined,
    collectedByName: searchParams.get("collectedByName") ?? undefined,
    receiptStatus: (searchParams.get("receiptStatus") as "NOT_LINKED" | "LINKED" | null) ?? undefined,
  });
  return NextResponse.json({ rows });
}
