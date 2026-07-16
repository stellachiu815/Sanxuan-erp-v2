import { NextRequest, NextResponse } from "next/server";
import { listBackupLogs } from "@/lib/backup";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { fileWebViewLink } from "@/lib/googleDrive";

/**
 * GET /api/system-center/backup/logs?operatorUserId=xxx
 * 需求「十二、備份Log」畫面用：列出備份紀錄（開始/完成時間、大小、
 * GDrive位置、成功/失敗、原因、執行者、自動或手動）。
 *
 * V11.2.1 補強（對應指令「九」）：補上執行秒數、Google Drive 檔案連結、
 * SHA-256、失敗階段/錯誤代碼、完整性檢查結果；「只有成功且檔案仍存在
 * 的備份，才能啟用下載及還原按鈕」交給前端依 `status === "SUCCESS" &&
 * googleDriveFileId` 判斷（見 BackupLogScreen.tsx）。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const logs = await listBackupLogs();
  return NextResponse.json({
    logs: logs.map((l) => ({
      id: l.id,
      type: l.type,
      status: l.status,
      startedAt: l.startedAt.toISOString(),
      finishedAt: l.finishedAt?.toISOString() ?? null,
      durationSeconds: l.finishedAt ? Math.round((l.finishedAt.getTime() - l.startedAt.getTime()) / 1000) : null,
      fileName: l.fileName,
      fileSizeBytes: l.fileSizeBytes ? Number(l.fileSizeBytes) : null,
      googleDriveFileId: l.googleDriveFileId,
      googleDriveFolder: l.googleDriveFolder,
      googleDriveFileWebViewLink: l.googleDriveFileId ? fileWebViewLink(l.googleDriveFileId) : null,
      failureReason: l.failureReason,
      failedStage: l.failedStage,
      errorCode: l.errorCode,
      sha256Checksum: l.sha256Checksum,
      reason: l.reason,
      executedByName: l.executedByName,
      isAutomatic: l.isAutomatic,
      lastIntegrityCheckAt: l.lastIntegrityCheckAt?.toISOString() ?? null,
      lastIntegrityCheckStatus: l.lastIntegrityCheckStatus,
      lastIntegrityCheckDetail: l.lastIntegrityCheckDetail,
    })),
  });
}
