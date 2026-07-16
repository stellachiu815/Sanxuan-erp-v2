import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { checkGoogleDriveHealth } from "@/lib/googleDrive";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { redactSensitive } from "@/lib/backupErrorClassifier";

const execFileAsync = promisify(execFile);

/** 剩餘磁碟空間（呼叫系統 `df` 指令，跟 backup.ts 的 pg_dump/zip 是同一種
 * 「不新增 npm 套件、依賴系統工具」的設計選擇；df 在絕大多數 Linux
 * 環境都內建）。任何一步失敗都回傳 null，不讓健康檢查其他項目被拖垮。 */
async function getDiskFreeSpace(): Promise<{ availableBytes: number; usedPercent: number } | null> {
  try {
    const { stdout } = await execFileAsync("df", ["-k", "--output=avail,pcent", "/"]);
    const lines = stdout.trim().split("\n");
    const dataLine = lines[lines.length - 1].trim().split(/\s+/);
    const availableKb = Number(dataLine[0]);
    const usedPercent = Number(dataLine[1].replace("%", ""));
    if (!Number.isFinite(availableKb) || !Number.isFinite(usedPercent)) return null;
    return { availableBytes: availableKb * 1024, usedPercent };
  } catch {
    return null;
  }
}

/**
 * V11.2.1 補強（對應指令「十五、6. 錯誤訊息不得包含完整 DATABASE_URL」）：
 * Prisma 連線失敗時的錯誤訊息，有機會把連線字串（可能含帳號密碼）整段包
 * 在訊息裡回傳——這支健康檢查 API 是給【系統管理中心】畫面直接顯示錯誤
 * 訊息用的（見 HealthCheckScreen.tsx），如果不先過濾，密碼有可能直接顯示
 * 在畫面上。跟 backup.ts／restore.ts 共用同一個 redactSensitive()（見
 * src/lib/backupErrorClassifier.ts），不重複寫一套過濾邏輯。
 */
async function getDatabaseHealth(): Promise<{ ok: boolean; error?: string }> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    return { ok: false, error: redactSensitive(rawMessage) };
  }
}

async function getLatestMigration(): Promise<string | null> {
  try {
    const rows = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 1`
    );
    return rows[0]?.migration_name ?? null;
  } catch {
    return null;
  }
}

/** V11.2.1 新增（對應指令「十四」）：確認系統工具指令是否存在，
 * 用 `which` 檢查而不是實際執行，避免健康檢查本身產生副作用。 */
async function checkExecutable(command: string): Promise<boolean> {
  try {
    await execFileAsync("which", [command]);
    return true;
  } catch {
    return false;
  }
}

/** V11.2.1 新增（對應指令「十四」）：只回報「已設定／未設定」，
 * 絕不回傳環境變數的實際內容。 */
function getRequiredEnvVarStatus(): Record<string, boolean> {
  const names = [
    "DATABASE_URL",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "GOOGLE_TOKEN_ENCRYPTION_KEY",
    "BACKUP_CRON_SECRET",
  ];
  return Object.fromEntries(names.map((name) => [name, !!process.env[name]]));
}

/**
 * GET /api/system-center/health?operatorUserId=xxx
 * 需求「十三、系統健康檢查」：Google Drive是否連線、資料庫是否正常、
 * 剩餘空間、最近備份、Migration版本、系統版本。
 *
 * V11.2.1 補強（對應指令「十四」）：新增備份根資料夾／四個子資料夾是否
 * 存在、最近一次備份完整性檢查、最近成功備份距今天數、pg_dump／
 * pg_restore／zip／unzip 是否可執行、重要環境變數是否存在（只顯示
 * 已設定/未設定，不顯示內容）。
 */
export async function GET(request: NextRequest) {
  const check = await assertSystemPermissionForOperator(
    request.nextUrl.searchParams.get("operatorUserId"),
    "viewSystemCenter"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const [googleDrive, googleDriveConn, database, diskSpace, latestMigration, latestBackup, latestSuccessfulBackup, pkg, tools] =
    await Promise.all([
      checkGoogleDriveHealth(),
      prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } }),
      getDatabaseHealth(),
      getDiskFreeSpace(),
      getLatestMigration(),
      prisma.backupLog.findFirst({ orderBy: { startedAt: "desc" } }),
      prisma.backupLog.findFirst({ where: { status: "SUCCESS" }, orderBy: { finishedAt: "desc" } }),
      readFile(path.join(process.cwd(), "package.json"), "utf8").then((s) => JSON.parse(s)),
      Promise.all(["pg_dump", "pg_restore", "zip", "unzip"].map(async (cmd) => [cmd, await checkExecutable(cmd)] as const)),
    ]);

  const daysSinceLastSuccess = latestSuccessfulBackup?.finishedAt
    ? Math.floor((Date.now() - latestSuccessfulBackup.finishedAt.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  return NextResponse.json({
    googleDrive,
    googleDriveFolders: {
      root: !!googleDriveConn?.rootFolderId,
      daily: !!googleDriveConn?.dailyFolderId,
      weekly: !!googleDriveConn?.weeklyFolderId,
      monthly: !!googleDriveConn?.monthlyFolderId,
      beforeUpdate: !!googleDriveConn?.beforeUpdateFolderId,
    },
    database,
    diskSpace,
    latestMigration,
    latestBackup: latestBackup
      ? {
          type: latestBackup.type,
          status: latestBackup.status,
          startedAt: latestBackup.startedAt.toISOString(),
          finishedAt: latestBackup.finishedAt?.toISOString() ?? null,
        }
      : null,
    daysSinceLastSuccessfulBackup: daysSinceLastSuccess,
    lastIntegrityCheck: latestSuccessfulBackup
      ? {
          checkedAt: latestSuccessfulBackup.lastIntegrityCheckAt?.toISOString() ?? null,
          status: latestSuccessfulBackup.lastIntegrityCheckStatus,
        }
      : null,
    systemTools: Object.fromEntries(tools),
    requiredEnvVars: getRequiredEnvVarStatus(),
    systemVersion: pkg.version,
  });
}
