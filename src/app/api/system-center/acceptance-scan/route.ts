import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { runAcceptanceScan } from "@/lib/acceptanceScanner";

/**
 * V19「驗收／健康檢查中心」——執行完整只讀資料掃描。
 *
 * GET /api/system-center/acceptance-scan
 *
 * 權限：僅 SUPER_ADMIN／ADMIN（canSystem runAcceptanceScan）；operator 一律取自 Session。
 * 只讀：runAcceptanceScan() 僅執行 read 查詢，不修改任何正式資料、金額、列印次數、
 * updatedAt 或交易狀態；不提供自動修復。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "runAcceptanceScan");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await runAcceptanceScan();
  return NextResponse.json({ ok: true, ...result });
}
