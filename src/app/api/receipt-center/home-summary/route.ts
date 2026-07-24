import { NextRequest, NextResponse } from "next/server";
import { getReceiptHomeSummary } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/receipt-center/home-summary — 首頁「收據提醒卡」用的彙總數字（需求「二」）。
 *
 * V11.1.1 新增：需要 ?operatorUserId=xxx，伺服器端真的查詢這個使用者的
 * 角色是否有「查看收據」權限，未通過回傳對應的 401/403（需求「二」：
 * 收據相關 API 必須在伺服器端實際檢查權限，不能只在畫面隱藏按鈕）。
 */
export async function GET(request: NextRequest) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertReceiptPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const summary = await getReceiptHomeSummary();
  return NextResponse.json(summary);
}
