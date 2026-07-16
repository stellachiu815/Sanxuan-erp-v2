import { NextRequest, NextResponse } from "next/server";
import { getReceiptDetail } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * GET /api/receipt-center/receipts/xxx?operatorUserId=xxx
 * 單張收據詳細內容（含明細/列印紀錄/收款主紀錄/換開鏈）。
 * V11.1.1 新增：需要 operatorUserId，伺服器端真的驗證「查看收據」權限。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const check = await assertReceiptPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const receipt = await getReceiptDetail(id);
  if (!receipt) return NextResponse.json({ error: "找不到這張收據" }, { status: 404 });
  return NextResponse.json(receipt);
}
