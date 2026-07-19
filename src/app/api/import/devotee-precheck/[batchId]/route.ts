/**
 * V11.3「信眾資料匯入預檢中心」正式版——查詢單一批次目前狀態。
 *
 * GET /api/import/devotee-precheck/xxx?operatorUserId=xxx
 *
 * 正式格式一列＝一戶、家戶編號是唯一鍵，一列本身的狀態（可匯入／資料不
 * 完整／格式錯誤）在分析當下就能一次算完，不會因為資料庫內容改變而變化，
 * 所以不論 PREVIEWED 或 COMMITTED，這支 API 都是直接回傳存好的結果，不會
 * 重新查資料庫（見 getDevoteeImportBatch 內部邏輯）。
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
