/**
 * V11.3「信眾資料匯入預檢中心」正式版——確認匯入前的再次確認視窗數字
 * （即將新增／更新家戶數、即將新增的成員／祖先／乙位正魂數——已經排除掉
 * 同一戶底下姓名已經存在的資料、不處理筆數，以及是否超過單批上限）。
 * 純查詢，不會寫入任何資料。
 *
 * GET /api/import/devotee-precheck/xxx/commit-preview?operatorUserId=xxx
 */
import { NextRequest, NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getCommitPreview } from "@/lib/devoteeImportBatch";

export async function GET(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  // V29 校正模式：即將新增家戶／成員一律 0（commit 不建立任何資料）。
  const correctionOnly = request.nextUrl.searchParams.get("correctionOnly") === "true";
  const preview = await getCommitPreview(batchId, correctionOnly);
  if (!preview.ok) {
    return NextResponse.json({ error: preview.error }, { status: 404 });
  }
  return NextResponse.json(preview);
}
