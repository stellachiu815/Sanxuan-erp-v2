/**
 * V11.3「信眾資料匯入預檢中心」正式版——確認匯入（單批上限 30 位家戶成員／
 * 10 戶、Transaction 寫入、結果凍結）。依序建立 Household → Member →
 * Ancestor（WorshipRecord type=ANCESTOR_LINE）→ Spirit（type=INDIVIDUAL）。
 *
 * POST /api/import/devotee-precheck/xxx/commit
 *   body: { operatorUserId }
 *
 * 這支路由本身只負責「認證 + 呼叫 commitDevoteeImport + 轉成 HTTP 回應」，
 * 真正的上限檢查／Transaction／防止重複送出都在 devoteeImportBatch.ts
 * 的 commitDevoteeImport() 裡（DB 層的原子搶佔鎖，不是只靠前端擋按鈕）。
 */
import { NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { commitDevoteeImport } from "@/lib/devoteeImportBatch";

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const body = await request.json().catch(() => ({}));

  const check = await assertSystemPermissionForOperator(body?.operatorUserId, "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { batchId } = await params;
  const result = await commitDevoteeImport(batchId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    householdsCreated: result.householdsCreated,
    householdsUpdated: result.householdsUpdated,
    membersCreated: result.membersCreated,
    ancestorsCreated: result.ancestorsCreated,
    spiritsCreated: result.spiritsCreated,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    failures: result.failures,
    committedAt: result.committedAt,
  });
}
