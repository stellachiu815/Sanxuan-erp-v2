import { NextRequest, NextResponse } from "next/server";
import { checkBackupIntegrity } from "@/lib/backup";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/system-center/backup/check-integrity
 *   body: { operatorUserId, backupLogId }
 *
 * 需求「十、增加檢查備份完整性功能」：由後端真正下載、比對、解壓縮驗證，
 * 不是因為 BackupLog 顯示 SUCCESS 就直接判定備份完整。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "downloadBackup");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  if (typeof body.backupLogId !== "string" || !body.backupLogId) {
    return NextResponse.json({ error: "請提供 backupLogId" }, { status: 400 });
  }

  const result = await checkBackupIntegrity(body.backupLogId);
  return NextResponse.json(result);
}
