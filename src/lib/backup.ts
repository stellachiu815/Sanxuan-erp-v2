import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { prisma } from "@/lib/prisma";
import { getFullPermissionSnapshot } from "@/lib/permissions";
import {
  getActiveAccessToken,
  ensureFolderStructure,
  uploadFile,
  listFilesInFolder,
  deleteFile,
  downloadFile,
} from "@/lib/googleDrive";
import { classifyBackupError, redactSensitive } from "@/lib/backupErrorClassifier";

const execFileAsync = promisify(execFile);

/**
 * V11.2.1 新增（對應指令「七、備份執行防重複機制」）：執行階段常數，
 * 供 currentStage 欄位使用，畫面依這個字串顯示對應的中文階段名稱
 * （見 src/lib/labels.ts backupStageLabel），不是假造的百分比進度。
 */
export const BACKUP_STAGE = {
  ACQUIRING_LOCK: "ACQUIRING_LOCK",
  PREPARING: "PREPARING",
  DUMPING_DATABASE: "DUMPING_DATABASE",
  WRITING_METADATA: "WRITING_METADATA",
  COMPRESSING: "COMPRESSING",
  UPLOADING: "UPLOADING",
  FINALIZING: "FINALIZING",
  DONE: "DONE",
} as const;

/** 備份鎖的存活時間——超過這個時間還沒釋放，視為異常中斷造成的失效鎖
 * （對應指令「七、4. 若前一次備份異常中斷，鎖定不得永久卡住」）。
 * 30 分鐘遠超過本系統目前資料量下備份實際需要的時間，足夠當作安全上限。 */
const BACKUP_LOCK_TTL_MS = 30 * 60 * 1000;

/**
 * V11.2「備份與還原中心」核心備份邏輯（對應指令「四」「五」「六」「七」
 * 「八」）。
 *
 * 【部署環境需求：這裡的程式碼會呼叫兩個系統指令，不是 npm 套件】
 * - `pg_dump`（PostgreSQL 16 對應版本的用戶端工具）：備份資料庫。
 * - `zip`（Info-ZIP 或相容工具）：把備份內容打包成 .zip。
 * 這個開發沙盒本身有裝這兩個工具（可以驗證指令組成方式正確），但正式
 * 部署環境（例如 Render 的 Node 執行環境）預設不一定有——見交付報告
 * 「部署環境需求」章節，建議改用 Dockerfile 型服務並在建置時安裝
 * `postgresql-client-16` 與 `zip`。這裡刻意不使用 `archiver`／`pg` 這類
 * npm 套件，是為了不要再增加任何一個新的 npm 依賴（見
 * src/lib/googleDrive.ts 開頭的說明），只依賴系統工具＋Node 內建模組。
 *
 * 【誠實揭露：這個沙盒可以驗證「指令組得對不對」，但無法驗證「Google
 * Drive 那一段」】
 * pg_dump／zip 這兩段本輪已經用這個沙盒的真實 PostgreSQL 資料庫實際執行
 * 驗證過（見 V11.2_Backup流程真實執行驗證紀錄.txt）；但 uploadFile() 呼叫
 * 的 Google Drive API 因為網路被擋，無法在這裡實際測試，只能靠程式碼
 * 審查（見 googleDrive.ts 說明）。
 */

const BACKUP_FOLDER_KEY: Record<
  "MANUAL" | "DAILY" | "WEEKLY" | "MONTHLY" | "BEFORE_UPDATE",
  "dailyFolderId" | "weeklyFolderId" | "monthlyFolderId" | "beforeUpdateFolderId"
> = {
  MANUAL: "dailyFolderId", // 需求「四」：立即備份上傳到 Daily
  DAILY: "dailyFolderId",
  WEEKLY: "weeklyFolderId",
  MONTHLY: "monthlyFolderId",
  BEFORE_UPDATE: "beforeUpdateFolderId",
};

const FOLDER_DISPLAY_NAME: Record<string, string> = {
  dailyFolderId: "Daily",
  weeklyFolderId: "Weekly",
  monthlyFolderId: "Monthly",
  beforeUpdateFolderId: "Before_Update",
};

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/**
 * V11.2.1 修正（對應指令「六、立即備份正式驗收」）：立即備份（MANUAL）
 * 的檔名格式指令明確指定為固定格式：
 * `SanxuanERP_Manual_YYYY-MM-DD_HHmmss.zip`
 * ——V11.2 原本產生的是 `Backup_YYYY-MM-DD_HHMM.zip`（沒有秒數、前綴也不
 * 一樣），這裡改成完全依照指令文字，不自行簡化或省略秒數。
 */
function formatManualBackupFileName(now: Date): string {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return `SanxuanERP_Manual_${y}-${m}-${d}_${hh}${mm}${ss}.zip`;
}

/**
 * Backup_YYYY-MM-DD_HHMM.zip——V11.2 既有的自動排程備份（DAILY／WEEKLY／
 * MONTHLY）檔名格式。V11.2.1 指令「六」明確指定的新檔名格式只針對「立即
 * 備份」（MANUAL），沒有要求更改自動排程備份的既有命名規則，依工作原則
 * 「一、1. 不重新設計已完成的功能」，這裡維持不變，只有 MANUAL 改用
 * formatManualBackupFileName()。
 * BEFORE_UPDATE 類型另外依需求（V11.2「八」）的範例採用不同命名：
 * `${versionLabel}_Before_Update.zip`（例如 V11.1.1_Before_Update.zip），
 * 不套用這個時間戳格式——見 formatBeforeUpdateFileName()。
 */
function formatBackupFileName(now: Date): string {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `Backup_${y}-${m}-${d}_${hh}${mm}.zip`;
}

/** 需求「八」範例：V11.1.1_Before_Update.zip。 */
function formatBeforeUpdateFileName(versionLabel: string): string {
  const cleaned = versionLabel.trim().replace(/^v/i, "V");
  const withPrefix = /^V/.test(cleaned) ? cleaned : `V${cleaned}`;
  return `${withPrefix}_Before_Update.zip`;
}

export type CreateBackupInput = {
  type: "MANUAL" | "DAILY" | "WEEKLY" | "MONTHLY" | "BEFORE_UPDATE";
  executedByName: string;
  executedByUserId?: string;
  isAutomatic: boolean;
  /** BEFORE_UPDATE 專用：版本標籤，例如 "11.1.1"（產生 V11.1.1_Before_Update.zip）。 */
  versionLabel?: string;
  /** V11.2.1 新增（對應指令「十一」）：還原前自動建立的保護性備份會傳入
   * "BEFORE_RESTORE"，寫入 BackupLog.reason 與 manifest.json，但沿用
   * 既有的 BEFORE_UPDATE 類型與 Before_Update 資料夾，不新增資料夾架構。 */
  reason?: string;
};

export type CreateBackupResult =
  | { ok: true; backupLogId: string; fileName: string; fileSizeBytes: number; googleDriveFileId: string; googleDriveFolder: string; sha256Checksum: string }
  | { ok: false; backupLogId: string; error: string; errorCode: string; failedStage: string }
  | { ok: false; locked: true; activeBackupLogId: string; error: string };

/**
 * V11.2.1 新增（對應指令「七」）：全系統唯一一把備份鎖，存在
 * SystemSetting（id="SINGLETON"）。用資料庫的 upsert/update 條件式寫入
 * 當作簡易的互斥鎖，不是完美的分散式鎖（Render 免費方案是單一 Node
 * process，這裡的鎖粒度足夠對應「同一時間只能執行一個備份工作」的需求，
 * 跟 oauthStateStore.ts 的「單一長時間執行 process」假設一致）。
 */
async function acquireBackupLock(): Promise<{ ok: true } | { ok: false; activeBackupLogId: string }> {
  const settings = await prisma.systemSetting.upsert({
    where: { id: "SINGLETON" },
    create: { id: "SINGLETON" },
    update: {},
  });

  const now = Date.now();
  const lockExpired =
    !settings.activeBackupLockExpiresAt || settings.activeBackupLockExpiresAt.getTime() < now;

  if (settings.activeBackupLogId && !lockExpired) {
    return { ok: false, activeBackupLogId: settings.activeBackupLogId };
  }

  // 沒有鎖，或鎖已經過期（上一次備份異常中斷、沒機會釋放鎖）——這裡先佔位，
  // 實際的 activeBackupLogId 在 createBackup() 建立 BackupLog 後才知道，
  // 所以用一個暫時的到期時間先佔住，避免兩個請求之間的競態窗口。
  await prisma.systemSetting.update({
    where: { id: "SINGLETON" },
    data: { activeBackupLockExpiresAt: new Date(now + BACKUP_LOCK_TTL_MS) },
  });
  return { ok: true };
}

async function bindBackupLock(backupLogId: string): Promise<void> {
  await prisma.systemSetting.update({
    where: { id: "SINGLETON" },
    data: { activeBackupLogId: backupLogId, activeBackupLockExpiresAt: new Date(Date.now() + BACKUP_LOCK_TTL_MS) },
  });
}

async function releaseBackupLock(backupLogId: string): Promise<void> {
  // 只釋放「屬於自己這次執行」的鎖——避免 A 的 finally 誤releases B 剛好
  // 佔到的鎖（理論上不會同時發生，因為鎖本身就防止並行，這裡是雙重保險）。
  await prisma.systemSetting.updateMany({
    where: { id: "SINGLETON", activeBackupLogId: backupLogId },
    data: { activeBackupLogId: null, activeBackupLockExpiresAt: null },
  });
}

/** 對應指令「六、11. 原始環境識別資訊」。只讀取，不含任何機密內容。 */
function describeSourceEnvironment(): string {
  const parts = [
    `host=${os.hostname()}`,
    `node=${process.version}`,
    `env=${process.env.NODE_ENV ?? "unknown"}`,
  ];
  if (process.env.RENDER_SERVICE_ID) parts.push(`renderService=${process.env.RENDER_SERVICE_ID}`);
  if (process.env.RENDER_GIT_COMMIT) parts.push(`gitCommit=${process.env.RENDER_GIT_COMMIT.slice(0, 12)}`);
  return parts.join(" ｜ ");
}

async function sha256OfFile(filePath: string): Promise<string> {
  const buffer = await readFile(filePath);
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function updateStage(backupLogId: string, stage: string): Promise<void> {
  await prisma.backupLog.update({ where: { id: backupLogId }, data: { currentStage: stage } }).catch(() => {
    // 更新階段字串失敗（例如資料庫瞬斷）不應該讓整個備份因此中止，
    // 只是畫面上的進度顯示會落後，不影響備份本身是否成功。
  });
}

/**
 * 建立一份完整備份：
 * 1. pg_dump 整個資料庫（自訂格式 -Fc，比純文字 SQL 更省空間、還原更快）。
 * 2. 附上 Prisma schema、Migration 狀態、版本資訊、權限矩陣快照、已上傳
 *    檔案（若有）。
 * 3. 打包成一個 zip，計算 SHA-256 校驗碼。
 * 4. 上傳到 Google Drive 對應資料夾。
 * 5. 寫入 BackupLog，並套用保留政策清掉過舊的備份。
 *
 * 需求「八」：如果是 BEFORE_UPDATE 類型且備份失敗，呼叫端（例如部署腳本）
 * 必須依照這個函式的回傳結果（ok:false）中止接下來的更新流程——這個函式
 * 本身不會，也不應該知道「呼叫它的人是不是正準備做更新」，中止更新的
 * 責任在呼叫端（例如一支 `scripts/pre-deploy-backup.ts`，見部署說明）。
 *
 * V11.2.1 補強（對應指令「七」）：整個函式一開始就嘗試取得全系統唯一的
 * 備份鎖，拿不到鎖代表已經有另一個備份正在執行中，直接回傳
 * `{ ok:false, locked:true, ... }`，不會建立新的 BackupLog（避免同時
 * 執行兩個備份工作互搶資源、或在 Google Drive 產生順序錯亂的檔案）。
 */
export async function createBackup(input: CreateBackupInput): Promise<CreateBackupResult> {
  const lock = await acquireBackupLock();
  if (!lock.ok) {
    return {
      ok: false,
      locked: true,
      activeBackupLogId: lock.activeBackupLogId,
      error: "目前已有備份正在執行，請勿重複操作。",
    };
  }

  const log = await prisma.backupLog.create({
    data: {
      type: input.type,
      status: "IN_PROGRESS",
      executedByName: input.executedByName,
      executedByUserId: input.executedByUserId,
      isAutomatic: input.isAutomatic,
      currentStage: BACKUP_STAGE.PREPARING,
      reason: input.reason,
      sourceEnvironment: describeSourceEnvironment(),
    },
  });
  await bindBackupLock(log.id);

  let stagingDir: string | null = null;
  let stage: string = BACKUP_STAGE.PREPARING;
  try {
    const now = new Date();
    const fileName =
      input.type === "BEFORE_UPDATE" && input.versionLabel
        ? formatBeforeUpdateFileName(input.versionLabel)
        : input.type === "MANUAL"
          ? formatManualBackupFileName(now)
          : formatBackupFileName(now);

    stagingDir = await mkdtemp(path.join(tmpdir(), "sanxuan-backup-"));

    stage = BACKUP_STAGE.DUMPING_DATABASE;
    await updateStage(log.id, stage);
    await dumpDatabase(stagingDir);

    stage = BACKUP_STAGE.WRITING_METADATA;
    await updateStage(log.id, stage);
    await writeSchemaSnapshot(stagingDir);
    await writeVersionSnapshot(stagingDir);
    await writePermissionSnapshot(stagingDir);
    await copyUploadedFilesIfAny(stagingDir);
    await writeManifest(stagingDir, {
      type: input.type,
      createdAt: now.toISOString(),
      reason: input.reason,
      sourceEnvironment: describeSourceEnvironment(),
    });

    stage = BACKUP_STAGE.COMPRESSING;
    await updateStage(log.id, stage);
    const zipPath = path.join(tmpdir(), `${log.id}-${fileName}`);
    await zipDirectory(stagingDir, zipPath);
    const zipStat = await stat(zipPath);
    const sha256Checksum = await sha256OfFile(zipPath);
    const zipBuffer = await readFile(zipPath);
    await rm(zipPath, { force: true });

    stage = BACKUP_STAGE.UPLOADING;
    await updateStage(log.id, stage);
    const accessToken = await getActiveAccessToken();
    const folders = await ensureFolderStructure(accessToken); // 保證資料夾存在（需求「三」）
    const folderKey = BACKUP_FOLDER_KEY[input.type];
    const folderId = (folders as Record<string, string>)[folderKey];

    const driveFileId = await uploadFile(accessToken, folderId, fileName, zipBuffer);

    stage = BACKUP_STAGE.FINALIZING;
    await prisma.backupLog.update({
      where: { id: log.id },
      data: {
        status: "SUCCESS",
        finishedAt: new Date(),
        fileName,
        fileSizeBytes: BigInt(zipStat.size),
        googleDriveFileId: driveFileId,
        googleDriveFolder: FOLDER_DISPLAY_NAME[folderKey],
        sha256Checksum,
        currentStage: BACKUP_STAGE.DONE,
      },
    });

    // 保留政策清理是「錦上添花」的收尾工作，不是備份本身是否成功的一部分
    // ——如果這裡失敗（例如刪除舊檔案時 Google Drive 暫時無回應），只記錄
    // 一個警告，不能讓已經真正成功、檔案也已經在 Google Drive 上的這次
    // 備份被回頭標記成 FAILED（V11.2.1 修正：這是本輪重新檢查時發現的
        // 既有邏輯缺陷——先前版本的保留政策清理跟主流程共用同一個 try/catch，
        // 一旦清理失敗會讓「已經成功的備份」被錯誤地覆蓋成 FAILED 狀態）。
    try {
      await applyRetentionPolicy(accessToken, folderId, input.type);
    } catch (cleanupErr) {
      const cleanupMessage = redactSensitive(cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr));
      await prisma.backupLog
        .update({
          where: { id: log.id },
          data: { failureReason: `備份成功，但保留政策清理舊備份時發生錯誤（不影響本次備份結果）：${cleanupMessage}` },
        })
        .catch(() => {});
    }

    await releaseBackupLock(log.id);

    return {
      ok: true,
      backupLogId: log.id,
      fileName,
      fileSizeBytes: zipStat.size,
      googleDriveFileId: driveFileId,
      googleDriveFolder: FOLDER_DISPLAY_NAME[folderKey],
      sha256Checksum,
    };
  } catch (err) {
    // V11.2.1 補強（對應指令「十五、6」「八、4」）：pg_dump 失敗時，Node
    // 丟出的錯誤訊息可能整段包含 DATABASE_URL（含密碼）——見
    // src/lib/backupErrorClassifier.ts 的 redactSensitive() 說明，這裡先
    // 過濾掉才能安全地存進 BackupLog、回傳給前端。
    const message = redactSensitive(err instanceof Error ? err.message : String(err));
    const { code } = classifyBackupError(message, stage);
    await prisma.backupLog.update({
      where: { id: log.id },
      data: { status: "FAILED", finishedAt: new Date(), failureReason: message, failedStage: stage, errorCode: code },
    });
    await releaseBackupLock(log.id);
    return { ok: false, backupLogId: log.id, error: message, errorCode: code, failedStage: stage };
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
    // 保險：不論成功或失敗都再確認一次鎖已經釋放（前面兩個分支理論上都已
    // 經呼叫過，這裡是防止漏掉任何一個新增的 return 路徑忘記釋放鎖）。
    await releaseBackupLock(log.id).catch(() => {});
  }
}

// ------------------------------------------------------------------
// 各項備份內容（對應指令「四」列出的 17 項）
// ------------------------------------------------------------------

/** 1/3/4/6/7/8/9/10/11/12/13/16：資料庫本身（涵蓋系統設定/使用者/家戶/
 * 活動/普渡/祭改/收款/收據/財務(預留)/收據流水號等全部資料表）。 */
async function dumpDatabase(stagingDir: string): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("缺少環境變數 DATABASE_URL，無法備份資料庫");
  const dumpPath = path.join(stagingDir, "database.dump");
  // -Fc：自訂格式（壓縮、可用 pg_restore 選擇性還原），比 -Fp 純文字省空間。
  await execFileAsync("pg_dump", ["--format=custom", "--file", dumpPath, databaseUrl], {
    maxBuffer: 1024 * 1024 * 256,
  });
}

/** 2：Prisma Schema 版本。 */
async function writeSchemaSnapshot(stagingDir: string): Promise<void> {
  const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
  const content = await readFile(schemaPath, "utf8");
  await writeFile(path.join(stagingDir, "schema.prisma"), content, "utf8");

  // 一併記錄目前已套用的 migration 清單（來自 _prisma_migrations 表），
  // 讓還原時可以核對「這份備份對應的 schema 版本」跟「目標資料庫目前的
  // migration 狀態」是否一致。
  try {
    const migrations = await prisma.$queryRawUnsafe<{ migration_name: string; finished_at: Date | null }[]>(
      `SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at ASC NULLS LAST`
    );
    await writeFile(path.join(stagingDir, "migrations.json"), JSON.stringify(migrations, null, 2), "utf8");
  } catch {
    // _prisma_migrations 表本身也已經包含在 database.dump 裡了，這裡讀不到
    // 不影響備份的完整性，只是少一份方便閱讀的清單，忽略即可。
  }
}

/** 17：系統版本。 */
async function writeVersionSnapshot(stagingDir: string): Promise<void> {
  const pkgPath = path.join(process.cwd(), "package.json");
  const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
  const version = {
    packageVersion: pkg.version,
    backupCreatedAt: new Date().toISOString(),
    nodeVersion: process.version,
  };
  await writeFile(path.join(stagingDir, "version.json"), JSON.stringify(version, null, 2), "utf8");
}

/** 5：權限（快照當下的完整權限矩陣，見 permissions.ts getFullPermissionSnapshot()）。 */
async function writePermissionSnapshot(stagingDir: string): Promise<void> {
  const snapshot = getFullPermissionSnapshot();
  await writeFile(path.join(stagingDir, "permissions-snapshot.json"), JSON.stringify(snapshot, null, 2), "utf8");
}

/**
 * 14/15：上傳圖片／PDF。
 *
 * ⚠️ 誠實揭露：目前這個系統本身還沒有任何「伺服器端持久保存上傳圖片或
 * PDF」的功能——收據 PDF 是瀏覽器端即時產生（html2canvas+jsPDF），從來
 * 不會存到伺服器；Excel 匯入用到的檔案上傳（FormData）也是處理完就丟棄，
 * 不會留在磁碟上。所以目前這一步實際上不會複製到任何檔案，是刻意保留的
 * 「向前相容」設計——只要指定的環境變數 `UPLOAD_STORAGE_DIR` 存在且真的
 * 有檔案，就會一併打包；未來如果系統新增了會員照片/簽名檔之類需要持久
 * 保存的檔案，只要存到這個目錄，備份會自動涵蓋，不需要再改這支函式。
 */
async function copyUploadedFilesIfAny(stagingDir: string): Promise<void> {
  const uploadDir = process.env.UPLOAD_STORAGE_DIR;
  const uploadsOut = path.join(stagingDir, "uploads");
  if (!uploadDir || !existsSync(uploadDir)) {
    await writeFile(
      path.join(stagingDir, "uploads-README.txt"),
      "目前系統沒有伺服器端持久保存的上傳圖片/PDF（皆為瀏覽器端即時產生或處理後即丟棄），" +
        "此備份不含這類檔案。若設定 UPLOAD_STORAGE_DIR 環境變數並在該目錄放置檔案，未來備份會自動包含。",
      "utf8"
    );
    return;
  }
  await execFileAsync("cp", ["-r", uploadDir, uploadsOut]);
}

async function writeManifest(
  stagingDir: string,
  meta: { type: string; createdAt: string; reason?: string; sourceEnvironment?: string }
): Promise<void> {
  await writeFile(
    path.join(stagingDir, "manifest.json"),
    JSON.stringify(
      {
        ...meta,
        // 「檢查備份完整性」用來確認這幾個檔案確實齊全（對應指令「十」）。
        requiredFiles: ["database.dump", "schema.prisma", "version.json", "permissions-snapshot.json", "manifest.json"],
      },
      null,
      2
    ),
    "utf8"
  );
}

async function zipDirectory(sourceDir: string, destZipPath: string): Promise<void> {
  // 在來源目錄「裡面」執行 zip -r，讓 zip 內的路徑是相對路徑（例如
  // database.dump、schema.prisma），而不是完整的暫存目錄絕對路徑。
  await execFileAsync("zip", ["-r", destZipPath, "."], { cwd: sourceDir, maxBuffer: 1024 * 1024 * 256 });
}

// ------------------------------------------------------------------
// 保留政策（需求「五」「六」「七」）
// ------------------------------------------------------------------

/**
 * Daily 保留 30 天、Weekly 保留 12 週、Monthly 永久保留（不清除）、
 * Before_Update 需求沒有明確要求保留上限，這裡也不自動刪除。
 *
 * 因為 MANUAL（立即備份）跟 DAILY 都放在同一個 Daily 資料夾（需求
 * 「四」：立即備份上傳到 Daily），保留政策直接依「資料夾裡實際有幾個
 * 檔案」判斷，而不是只看 BackupLog 資料表裡 type=DAILY 的筆數——這樣
 * 才會真的符合「這個資料夾最多留 30 份」的需求本意。
 */
async function applyRetentionPolicy(
  accessToken: string,
  folderId: string,
  type: CreateBackupInput["type"]
): Promise<void> {
  if (type === "MONTHLY" || type === "BEFORE_UPDATE") return; // 永久保留，不清除

  const settings = await prisma.systemSetting.upsert({
    where: { id: "SINGLETON" },
    create: { id: "SINGLETON" },
    update: {},
  });
  const keepCount = type === "WEEKLY" ? settings.weeklyRetentionWeeks : settings.dailyRetentionDays;

  const files = await listFilesInFolder(accessToken, folderId); // 已經依 createdTime 新到舊排序
  if (files.length <= keepCount) return;

  const toDelete = files.slice(keepCount);
  for (const file of toDelete) {
    await deleteFile(accessToken, file.id);
  }
}

// ------------------------------------------------------------------
// 讀取備份清單／Log（給還原中心／系統Log畫面使用）
// ------------------------------------------------------------------

export async function listBackupLogs(limit = 100) {
  return prisma.backupLog.findMany({
    orderBy: { startedAt: "desc" },
    take: limit,
  });
}

export type BrowseFolder = "Daily" | "Weekly" | "Monthly" | "Before_Update";

/** 還原中心瀏覽用：直接向 Google Drive 查詢對應資料夾目前實際有哪些檔案。 */
export async function browseBackupFolder(folder: BrowseFolder) {
  const conn = await prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } });
  if (!conn || conn.status !== "CONNECTED") {
    throw new Error("尚未連結 Google Drive");
  }
  const folderIdKey =
    folder === "Daily"
      ? "dailyFolderId"
      : folder === "Weekly"
        ? "weeklyFolderId"
        : folder === "Monthly"
          ? "monthlyFolderId"
          : "beforeUpdateFolderId";
  const folderId = (conn as unknown as Record<string, string | null>)[folderIdKey];
  if (!folderId) throw new Error(`尚未建立 ${folder} 資料夾`);
  const accessToken = await getActiveAccessToken();
  return listFilesInFolder(accessToken, folderId);
}

// ------------------------------------------------------------------
// V11.2.1 新增：檢查備份完整性（對應指令「十」）
// ------------------------------------------------------------------

export type IntegrityCheckStatus =
  | "COMPLETE"
  | "FILE_NOT_FOUND"
  | "CHECKSUM_MISMATCH"
  | "ZIP_CORRUPT"
  | "CONTENT_MISSING"
  | "CHECK_FAILED";

export type IntegrityCheckResult = {
  status: IntegrityCheckStatus;
  detail: string;
};

/**
 * 需求「十」逐項真實執行（不是因為 BackupLog 顯示 SUCCESS 就直接判定
 * 完整）：
 * 1. 確認 Google Drive 檔案仍存在（下載本身就是最直接的存在性確認）。
 * 2. 確認檔案大小大於 0。
 * 3. 下載至暫存目錄。
 * 4. 比對 SHA-256 checksum（跟 BackupLog.sha256Checksum 比對）。
 * 5. 確認 ZIP 可解壓縮（`unzip -t` 測試完整性，不是真的解到磁碟上）。
 * 6. 確認 manifest 存在／7. database.dump 存在／8. 必要檔案齊全。
 * 9. 完成後清除暫存檔（無論成功失敗都會清除，見 finally）。
 */
export async function checkBackupIntegrity(backupLogId: string): Promise<IntegrityCheckResult> {
  const log = await prisma.backupLog.findUnique({ where: { id: backupLogId } });
  if (!log) return { status: "CHECK_FAILED", detail: "找不到這筆備份紀錄" };
  if (log.status !== "SUCCESS" || !log.googleDriveFileId) {
    return { status: "CHECK_FAILED", detail: "這筆備份紀錄本身不是成功狀態，無法檢查完整性" };
  }

  let stagingDir: string | null = null;
  let result: IntegrityCheckResult;
  try {
    const accessToken = await getActiveAccessToken();

    // 1+3：下載（下載失敗、找不到檔案，Google Drive 會回傳 404，
    // downloadFile() 內部會丟出帶 HTTP 狀態碼的錯誤）。
    let zipBuffer: Buffer;
    try {
      zipBuffer = await downloadFile(accessToken, log.googleDriveFileId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { status: "FILE_NOT_FOUND", detail: `無法從 Google Drive 下載此備份檔案：${message}` };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }

    // 2：檔案大小必須大於 0。
    if (zipBuffer.byteLength === 0) {
      result = { status: "FILE_NOT_FOUND", detail: "檔案存在但大小為 0 bytes，視為無效備份" };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }

    stagingDir = await mkdtemp(path.join(tmpdir(), "sanxuan-integrity-"));
    const zipPath = path.join(stagingDir, "backup.zip");
    await writeFile(zipPath, zipBuffer);

    // 4：比對 SHA-256（只有備份當時就有記錄校驗碼的才能比對；V11.2.1
    // 之前建立的舊備份沒有這個欄位，這種情況略過比對，不當作失敗）。
    if (log.sha256Checksum) {
      const actualChecksum = crypto.createHash("sha256").update(zipBuffer).digest("hex");
      if (actualChecksum !== log.sha256Checksum) {
        result = {
          status: "CHECKSUM_MISMATCH",
          detail: `SHA-256 不相符：預期 ${log.sha256Checksum}，實際 ${actualChecksum}`,
        };
        await saveIntegrityResult(backupLogId, result);
        return result;
      }
    }

    // 5：ZIP 完整性測試（-t 只測試不解壓縮到磁碟）。
    try {
      await execFileAsync("unzip", ["-t", zipPath]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { status: "ZIP_CORRUPT", detail: `ZIP 檔案損壞，無法通過完整性測試：${message}` };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }

    // 6+7+8：解壓縮並確認 manifest.json / database.dump / 其他必要檔案都在。
    await execFileAsync("unzip", ["-o", zipPath, "-d", stagingDir]);
    const manifestPath = path.join(stagingDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      result = { status: "CONTENT_MISSING", detail: "缺少 manifest.json" };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const requiredFiles: string[] = manifest.requiredFiles ?? ["database.dump", "schema.prisma", "version.json"];
    const missing = requiredFiles.filter((f: string) => !existsSync(path.join(stagingDir!, f)));
    if (missing.length > 0) {
      result = { status: "CONTENT_MISSING", detail: `缺少必要檔案：${missing.join("、")}` };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }

    // database.dump 除了「存在」以外，額外用 pg_restore --list 確認是一份
    // PostgreSQL 工具真的看得懂的格式（不是空檔案或損毀內容）。
    try {
      await execFileAsync("pg_restore", ["--list", path.join(stagingDir, "database.dump")]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result = { status: "CONTENT_MISSING", detail: `database.dump 存在，但無法被 pg_restore 辨識：${message}` };
      await saveIntegrityResult(backupLogId, result);
      return result;
    }

    result = { status: "COMPLETE", detail: "檔案存在、大小正常、SHA-256 相符、ZIP 完整、必要內容齊全" };
    await saveIntegrityResult(backupLogId, result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { status: "CHECK_FAILED", detail: `完整性檢查本身發生錯誤：${message}` };
    await saveIntegrityResult(backupLogId, result);
    return result;
  } finally {
    // 9：完成後清除暫存檔。
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
  }
}

async function saveIntegrityResult(backupLogId: string, result: IntegrityCheckResult): Promise<void> {
  await prisma.backupLog
    .update({
      where: { id: backupLogId },
      data: {
        lastIntegrityCheckAt: new Date(),
        lastIntegrityCheckStatus: result.status,
        lastIntegrityCheckDetail: result.detail,
      },
    })
    .catch(() => {});
}

// ------------------------------------------------------------------
// V11.2.1 新增：自動排程狀態（對應指令「十二」）
// ------------------------------------------------------------------

export type ScheduleTypeStatus = {
  type: "DAILY" | "WEEKLY" | "MONTHLY";
  lastRunAt: string | null;
  lastRunStatus: "SUCCESS" | "FAILED" | null;
  nextScheduledAt: string;
  /** 是否曾經真的收到過一次「自動」觸發——這是唯一能誠實判斷「外部排程
   * 服務是否已經設定」的證據；沒有任何自動紀錄時，不能宣稱排程已啟用。 */
  everConfirmedAutomatic: boolean;
};

function nextRunAt(type: "DAILY" | "WEEKLY" | "MONTHLY", now: Date): Date {
  const next = new Date(now);
  if (type === "DAILY") {
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    return next;
  }
  if (type === "WEEKLY") {
    next.setHours(3, 0, 0, 0);
    const daysUntilSunday = (7 - next.getDay()) % 7;
    next.setDate(next.getDate() + daysUntilSunday);
    if (next <= now) next.setDate(next.getDate() + 7);
    return next;
  }
  // MONTHLY：每月 1 號 04:00
  next.setHours(4, 0, 0, 0);
  next.setDate(1);
  if (next <= now) {
    next.setMonth(next.getMonth() + 1);
    next.setDate(1);
  }
  return next;
}

/**
 * 需求「十二」：不得只因為 route 已存在，就宣稱自動備份已完成——這裡的
 * `everConfirmedAutomatic` 只有在真的查到至少一筆 `isAutomatic=true` 且
 * type 相符的 BackupLog 時才是 true，這是唯一站得住腳的證據來源。畫面
 * 看到 false 時必須顯示「系統 API 已準備完成，但外部排程服務尚未確認」，
 * 不能顯示為已啟用。
 */
export async function getScheduleStatus(): Promise<ScheduleTypeStatus[]> {
  const now = new Date();
  const types: ("DAILY" | "WEEKLY" | "MONTHLY")[] = ["DAILY", "WEEKLY", "MONTHLY"];
  const results: ScheduleTypeStatus[] = [];
  for (const type of types) {
    const lastRun = await prisma.backupLog.findFirst({
      where: { type, isAutomatic: true },
      orderBy: { startedAt: "desc" },
    });
    results.push({
      type,
      lastRunAt: lastRun?.startedAt.toISOString() ?? null,
      lastRunStatus: lastRun ? (lastRun.status === "SUCCESS" ? "SUCCESS" : lastRun.status === "FAILED" ? "FAILED" : null) : null,
      nextScheduledAt: nextRunAt(type, now).toISOString(),
      everConfirmedAutomatic: !!lastRun,
    });
  }
  return results;
}
