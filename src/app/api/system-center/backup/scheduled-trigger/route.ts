import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createBackup } from "@/lib/backup";
import { prisma } from "@/lib/prisma";

/** V14.3：timing-safe 密鑰比對，避免以字串長度/內容差異被時間側通道推測。 */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/system-center/backup/scheduled-trigger?type=daily|weekly|monthly
 *   header: x-backup-cron-secret: <BACKUP_CRON_SECRET>
 *
 * 需求「五、自動每日備份」「六、每週備份」「七、每月備份」：這支 API
 * 不是給人操作的（沒有 operatorUserId 概念），是給外部排程來源（Render
 * Cron Job／cron-job.org／GitHub Actions 排程等，見 render.yaml 的說明）
 * 在固定時間呼叫的。因為呼叫者不是「登入的人」，這裡改用共用密鑰
 * （BACKUP_CRON_SECRET 環境變數）驗證，而不是 operatorUserId／角色權限
 * ——這是刻意的設計差異，不是忘記加權限檢查。
 *
 * ⚠️ 如果沒有設定 BACKUP_CRON_SECRET 環境變數，這支 API 會一律拒絕執行
 * （不會「沒設定就跳過檢查」），避免任何人不需要密鑰就能觸發備份。
 *
 * V11.2.1 補強（對應指令「十二、7. 同一天重複觸發時是否有防重複機制」）：
 * 外部排程服務設定錯誤（例如同一天被觸發兩次）時，如果同一種類型當天
 * （以 Asia/Taipei 時區認定「同一天」，對應指令「五. 時區是否使用
 * Asia/Taipei」）已經有一筆成功的自動備份，就不重複執行，直接回報
 * 「已於今日執行過」，避免浪費 Google Drive 空間、觸發保留政策誤刪。
 * 呼叫端傳來的重複請求本身不算錯誤，所以這裡回傳 200 而不是 4xx/5xx。
 */

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

function taipeiDateKey(date: Date): string {
  const taipei = new Date(date.getTime() + TAIPEI_OFFSET_MS);
  return `${taipei.getUTCFullYear()}-${taipei.getUTCMonth()}-${taipei.getUTCDate()}`;
}

export async function POST(request: NextRequest) {
  // V14.3：排程觸發是「機器呼叫」，不使用一般使用者 session；改以專用密鑰驗證
  // （BACKUP_SCHEDULE_SECRET 優先，相容既有 BACKUP_CRON_SECRET），timing-safe 比對。
  // 未設定密鑰 → 503（功能未啟用）；未提供或錯誤密鑰 → 401；一律不接受 operatorUserId。
  const expectedSecret = process.env.BACKUP_SCHEDULE_SECRET || process.env.BACKUP_CRON_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "系統尚未設定排程備份密鑰，排程觸發功能未啟用" }, { status: 503 });
  }
  const providedSecret =
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    request.headers.get("x-backup-cron-secret");
  if (!secretMatches(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "密鑰不正確或未提供" }, { status: 401 });
  }

  const type = request.nextUrl.searchParams.get("type");
  const typeMap: Record<string, "DAILY" | "WEEKLY" | "MONTHLY"> = {
    daily: "DAILY",
    weekly: "WEEKLY",
    monthly: "MONTHLY",
  };
  const backupType = type ? typeMap[type.toLowerCase()] : undefined;
  if (!backupType) {
    return NextResponse.json({ error: "請提供 ?type=daily|weekly|monthly" }, { status: 400 });
  }

  const now = new Date();
  const lastSuccess = await prisma.backupLog.findFirst({
    where: { type: backupType, isAutomatic: true, status: "SUCCESS" },
    orderBy: { finishedAt: "desc" },
  });
  if (lastSuccess?.finishedAt && taipeiDateKey(lastSuccess.finishedAt) === taipeiDateKey(now)) {
    return NextResponse.json({
      ok: true,
      skipped: true,
      reason: `今日（Asia/Taipei）已經成功執行過一次 ${backupType} 自動備份，略過本次重複觸發`,
      previousBackupLogId: lastSuccess.id,
    });
  }

  const result = await createBackup({
    type: backupType,
    executedByName: "系統排程（自動）",
    isAutomatic: true,
  });

  if (!result.ok) {
    if ("locked" in result) {
      return NextResponse.json({ error: result.error, locked: true }, { status: 409 });
    }
    return NextResponse.json({ error: result.error, errorCode: result.errorCode }, { status: 500 });
  }
  return NextResponse.json(result, { status: 201 });
}
