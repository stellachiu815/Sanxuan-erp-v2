import { NextRequest, NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { saveMemberResolution, countPendingResolutions } from "@/lib/devoteeImportBatch";

/**
 * V12.6 驗收修正：儲存「疑似重複」成員的人工決定。
 *
 * POST /api/import/devotee-precheck/[batchId]/resolution
 * body: {
 *   operatorUserId, rowId, memberName,
 *   decision: "KEEP_ORIGINAL" | "TRANSFER_IN" | "CREATE_NEW" | "SKIP",
 *   memberId?  // KEEP_ORIGINAL／TRANSFER_IN 時必填，指定是哪一位既有信眾
 * }
 *
 * ── 為什麼需要這一支 ──
 * ImportRow 的 resolutionDecision／resolutionHouseholdId／resolutionMemberId
 * 三個欄位在 schema 裡一直存在，但 V11.3 改版時把對應的 API 與 UI 一併移除了
 * （見 devoteeImportBatch.ts 檔頭註解），導致 V12.6 雖然會把疑似重複標示出來，
 * 使用者卻沒有任何管道可以做決定。這支 route 只是把那個被移除的儲存管道補
 * 回來，**寫入的是既有欄位，沒有新增任何 Prisma 欄位或資料表**。
 *
 * 權限沿用既有的 manageDataImport（SUPER_ADMIN／ADMIN），跟同批次的
 * analyze／commit 完全一致，不新增第二套權限。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertSystemPermissionForOperator(body.operatorUserId, "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const rowId = typeof body.rowId === "string" ? body.rowId : "";
  const memberName = typeof body.memberName === "string" ? body.memberName : "";
  const decision = body.decision;
  const validDecisions = ["KEEP_ORIGINAL", "TRANSFER_IN", "CREATE_NEW", "SKIP"];
  if (!rowId || !memberName || !validDecisions.includes(decision)) {
    return NextResponse.json({ error: "請提供正確的列、成員與處理方式" }, { status: 400 });
  }

  const result = await saveMemberResolution({
    batchId,
    rowId,
    memberName,
    decision,
    memberId: typeof body.memberId === "string" ? body.memberId : null,
    operatorName: check.operator.name,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  // 回傳整批剩餘待確認數，讓畫面即時更新「正式匯入」按鈕的啟用狀態。
  const pendingTotal = await countPendingResolutions(batchId);

  return NextResponse.json({
    ok: true,
    rowStatus: result.status,
    rowPendingCount: result.pendingCount,
    pendingTotal,
  });
}
