import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { backupStageLabel } from "@/lib/labels";

/**
 * GET /api/system-center/backup/run-status?operatorUserId=xxx[&backupLogId=xxx]
 *
 * 需求「七、7. 顯示目前進度階段」：前端在等待 POST /backup/run 回應的
 * 同時，另外用這支輕量的查詢每隔幾秒輪詢一次，顯示「準備資料/匯出資料庫/
 * 建立備份資訊/壓縮檔案/上傳 Google Drive/寫入備份紀錄/完成」目前卡在
 * 哪一個階段——這是真實的階段字串（見 backup.ts 執行過程中即時寫入的
 * currentStage 欄位），不是假造的百分比進度條。
 *
 * 不帶 `backupLogId` 時：因為送出 POST /backup/run 當下還不知道這次備份
 * 的 BackupLog id（要等整個備份做完那支 API 才會回應），改查全系統唯一
 * 的備份鎖（SystemSetting.activeBackupLogId，見 src/lib/backup.ts）目前
 * 指向哪一筆，用那一筆的進度回報——因為同一時間只可能有一個備份在執行
 * （對應指令「七」的鎖機制），這樣查一定拿得到「目前正在跑的那一筆」。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "viewSystemCenter");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  let backupLogId = searchParams.get("backupLogId");
  if (!backupLogId) {
    const settings = await prisma.systemSetting.findUnique({ where: { id: "SINGLETON" } });
    backupLogId = settings?.activeBackupLogId ?? null;
  }
  if (!backupLogId) return NextResponse.json({ status: null, currentStage: null, currentStageLabel: null });

  const log = await prisma.backupLog.findUnique({ where: { id: backupLogId } });
  if (!log) return NextResponse.json({ status: null, currentStage: null, currentStageLabel: null });

  return NextResponse.json({
    backupLogId: log.id,
    status: log.status,
    currentStage: log.currentStage,
    currentStageLabel: log.currentStage ? (backupStageLabel[log.currentStage] ?? log.currentStage) : null,
    failedStage: log.failedStage,
    errorCode: log.errorCode,
    failureReason: log.failureReason,
  });
}
