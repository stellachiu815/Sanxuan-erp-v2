/**
 * V11.3「信眾資料匯入預檢中心」正式版——確認匯入。依序建立
 * Household → Member → Ancestor（WorshipRecord type=ANCESTOR_LINE）→
 * Spirit（type=INDIVIDUAL）。
 *
 * POST /api/import/devotee-precheck/xxx/commit
 *   body: { operatorUserId, chunkSize? }
 *
 * ⚠️ V12.7：**單次筆數上限已移除**（原本是 10 戶／30 位成員）。
 *
 * 這支路由現在會處理「一批」（預設 100 戶）並回傳進度：
 *
 *   { done, processedHouseholds, totalHouseholds, remainingHouseholds, ... }
 *
 * `done === false` 時，前端會自動再呼叫一次同一支 API 繼續下一批，直到
 * 全部完成——**使用者從頭到尾只按一次【確認匯入】**，分批完全發生在系統
 * 內部。這是沿用既有路由擴充，沒有新增第二支 API、沒有第二套流程。
 *
 * 認證與真正的交易／防重複邏輯都在 devoteeImportBatch.ts 的
 * commitDevoteeImport()（row-level 冪等，不是只靠前端擋按鈕）。
 */
import { NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { commitDevoteeImport, DEFAULT_COMMIT_CHUNK_SIZE } from "@/lib/devoteeImportBatch";

/**
 * V12.7：一批 50 戶大約需要十幾秒，明確拉高單一請求的可執行時間上限，
 * 避免在有函式逾時限制的平台上被中途砍掉。（Render 的一般 Web Service
 * 不套用這個值，但設定了在其他部署環境也安全。）
 */
export const maxDuration = 300;

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  const body = await request.json().catch(() => ({}));

  const check = await assertSystemPermissionForOperator(body?.operatorUserId, "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // 批次大小可由呼叫端調整（預設 50 戶）。設上限避免有人傳超大數字，
  // 導致單一交易又回到「一次跑完全部」而超時。
  const rawChunk = Number(body?.chunkSize);
  const chunkSize = Number.isFinite(rawChunk) && rawChunk > 0
    ? Math.min(Math.trunc(rawChunk), 500)
    : DEFAULT_COMMIT_CHUNK_SIZE;

  const { batchId } = await params;
  const result = await commitDevoteeImport(batchId, check.operator.name, { chunkSize });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    householdsCreated: result.householdsCreated,
    householdsUpdated: result.householdsUpdated,
    membersCreated: result.membersCreated,
    membersUpdated: result.membersUpdated,
    ancestorsCreated: result.ancestorsCreated,
    spiritsCreated: result.spiritsCreated,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    failures: result.failures,
    committedAt: result.committedAt,
    // V12.7：進度資訊，前端用來決定要不要繼續下一批並顯示「N / 總數」
    done: result.done,
    processedHouseholds: result.processedHouseholds,
    totalHouseholds: result.totalHouseholds,
    remainingHouseholds: result.remainingHouseholds,
  });
}
