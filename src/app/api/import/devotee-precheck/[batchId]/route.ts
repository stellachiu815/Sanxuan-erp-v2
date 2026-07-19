/**
 * V11.3「信眾資料匯入預檢中心」——查詢單一批次目前狀態（需求「第二步」～
 * 「第六步」的畫面資料來源）。
 *
 * GET /api/import/devotee-precheck/xxx?operatorUserId=xxx
 *
 * 尚未確認（PREVIEWED）的批次：疑似重複／待確認家戶是即時重新查資料庫算出來
 * 的（需求確認④），每次呼叫這支 API 結果都可能因為資料庫內容改變而不同。
 * 已確認（COMMITTED）的批次：一律回傳當時真正執行的結果，不會重新計算
 * （見 getDevoteeImportBatch 內部邏輯）。
 */
import { NextRequest, NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { getDevoteeImportBatch } from "@/lib/devoteeImportBatch";

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const view = await getDevoteeImportBatch(batchId);
  if (!view) {
    return NextResponse.json({ error: "找不到這個匯入批次" }, { status: 404 });
  }
  return NextResponse.json(view);
}
