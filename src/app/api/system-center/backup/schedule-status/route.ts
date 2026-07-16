import { NextRequest, NextResponse } from "next/server";
import { getScheduleStatus } from "@/lib/backup";
import { assertSystemPermissionForOperator } from "@/lib/operator";

/**
 * GET /api/system-center/backup/schedule-status?operatorUserId=xxx
 *
 * 需求「十二、自動備份排程檢查」：系統管理頁面顯示每日/每週/每月排程
 * 狀態、下一次預定時間、上一次執行時間與結果。`everConfirmedAutomatic`
 * 為 false 時，前端必須顯示「系統 API 已準備完成，但外部排程服務尚未
 * 確認。」，不得顯示為已啟用——見 src/lib/backup.ts getScheduleStatus()
 * 的說明，這是唯一站得住腳的判斷依據（真的收到過至少一次自動觸發）。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const schedules = await getScheduleStatus();
  return NextResponse.json({ schedules });
}
