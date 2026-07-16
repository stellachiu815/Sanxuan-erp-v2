import { NextRequest, NextResponse } from "next/server";
import { getReceiptStats } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * GET /api/receipt-center/stats — 需求「十六、收據統計」。
 *   query: ?operatorUserId&dateFrom&dateTo
 * V11.1.1 新增：需要 ?operatorUserId=xxx，伺服器端真的驗證「查看收據」權限。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertReceiptPermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const stats = await getReceiptStats({
    dateFrom: searchParams.get("dateFrom") ? new Date(searchParams.get("dateFrom")!) : undefined,
    dateTo: searchParams.get("dateTo") ? new Date(searchParams.get("dateTo")!) : undefined,
  });
  return NextResponse.json(stats);
}
