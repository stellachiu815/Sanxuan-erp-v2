/**
 * V11.3「信眾資料匯入預檢中心」——第十步：下載錯誤清單 CSV
 * （資料不完整／格式錯誤／待確認家戶的列：原始列號／姓名／錯誤原因／
 * 原始資料摘要——刻意不包含任何伺服器內部錯誤訊息或堆疊，只有使用者看
 * 得懂、對得到 Excel 原始列的內容）。
 *
 * GET /api/import/devotee-precheck/xxx/error-csv?operatorUserId=xxx
 */
import { NextRequest, NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { buildDevoteeImportErrorCsv } from "@/lib/devoteeImportBatch";

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const result = await buildDevoteeImportErrorCsv(batchId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  // 加上 UTF-8 BOM，避免 Excel 開啟中文 CSV 出現亂碼（沿用一般 CSV 匯出慣例）。
  const csvWithBom = "﻿" + result.csv;
  return new NextResponse(csvWithBom, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="devotee-import-errors-${batchId}.csv"`,
    },
  });
}
