/**
 * V11.3「信眾資料匯入預檢中心」——第八步：確認匯入前的再次確認視窗數字
 * （即將新增家戶數／信眾數／略過筆數／疑似重複筆數／錯誤筆數，以及是否
 * 超過測試匯入上限）。純查詢，不會寫入任何資料。
 *
 * GET /api/import/devotee-precheck/xxx/commit-preview?operatorUserId=xxx
 */
import { NextRequest, NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { getCommitPreview } from "@/lib/devoteeImportBatch";

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const preview = await getCommitPreview(batchId);
  if (!preview.ok) {
    return NextResponse.json({ error: preview.error }, { status: 404 });
  }
  return NextResponse.json(preview);
}
