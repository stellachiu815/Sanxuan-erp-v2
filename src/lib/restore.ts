import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { resolveOperator } from "@/lib/operator";
import { canSystem } from "@/lib/permissions";
import { recordVersion } from "@/lib/recordVersion";
import { getActiveAccessToken, downloadFile } from "@/lib/googleDrive";
import { createBackup, checkBackupIntegrity } from "@/lib/backup";
import { redactSensitive } from "@/lib/backupErrorClassifier";

const execFileAsync = promisify(execFile);

/**
 * V11.2「一鍵還原」核心邏輯（對應指令「九」）。
 *
 * ⚠️ 這是全系統裡風險最高的一支函式：會用備份內容「完整覆蓋」目前的
 * 資料庫。需求明確要求「不得只還原部分資料」，所以這裡用
 * `pg_restore --clean --if-exists`（還原前先清掉目前資料庫裡的物件）
 * ＋ `--single-transaction`（整個還原包在同一個交易裡，只要中途任何一步
 * 失敗就整個回滾，不會留下「還原到一半」的壞資料庫狀態）。
 *
 * 【多一層防呆：必須輸入要還原的檔名做二次確認】
 * 前端會先跳出「是否確定覆蓋目前資料？」的畫面確認（見
 * ReceiptCenter 既有的 ConfirmDialog 慣例），但這裡的伺服器端**額外**
 * 要求呼叫端把 `confirmFileName` 設成「跟要還原的這份備份完全相同的
 * 檔名」，模仿常見的「輸入 DELETE 才能刪除」防呆模式——避免畫面上的
 * 確認框被程式化繞過（例如重複點擊、竟外的第二次呼叫）就真的執行這個
 * 不可逆的操作。
 *
 * 【誠實揭露：這個沙盒無法真實測試「從 Google Drive 下載」這一段】
 * downloadFile() 需要真正連上 googleapis.com，這個沙盒對外一律 403。
 * 但「解壓縮→pg_restore」這一段的邏輯，已經用真實資料庫做過端對端驗證
 * （見 V11.2_Backup流程真實執行驗證紀錄.txt 步驟 8：pg_dump→zip→
 * pg_restore 到全新資料庫，47 個資料表、5 筆測試使用者全部正確還原）。
 */

export type RestoreBackupInput = {
  googleDriveFileId: string;
  fileName: string;
  confirmFileName: string;
  operatorUserId: string;
};

export type RestoreBackupResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

export async function restoreFromBackup(input: RestoreBackupInput): Promise<RestoreBackupResult> {
  const operator = await resolveOperator(input.operatorUserId);
  if (!operator) return { ok: false, status: 401, error: "找不到有效的操作人員身分，請重新選擇目前操作人員" };
  if (!canSystem(operator.role, "restoreBackup")) {
    return { ok: false, status: 403, error: `目前操作人員（${operator.name}）沒有還原備份的權限` };
  }
  if (input.confirmFileName !== input.fileName) {
    return { ok: false, status: 400, error: "確認檔名不相符，請重新輸入完整的備份檔名以確認還原" };
  }

  // V11.2.1 新增（對應指令「六、備份完整性檢查未通過時，禁止還原」「六、
  // ZIP 缺少 database.dump 時，禁止還原」）：還原前先真的下載、驗證這份
  // 備份，而不是只信任 BackupLog.status === "SUCCESS"。
  const targetLog = await prisma.backupLog.findFirst({
    where: { googleDriveFileId: input.googleDriveFileId, fileName: input.fileName },
    orderBy: { startedAt: "desc" },
  });
  if (targetLog) {
    const integrity = await checkBackupIntegrity(targetLog.id);
    if (integrity.status !== "COMPLETE") {
      return {
        ok: false,
        status: 409,
        error: `備份完整性檢查未通過（${integrity.status}），已禁止還原：${integrity.detail}`,
      };
    }
  }
  // 找不到對應 BackupLog 的情況（例如手動貼上的 fileId）理論上不會發生，
  // 因為前端一律從還原中心的清單挑選；這裡不因為「找不到 Log」就直接
  // 擋下還原，避免誤傷真正合法但 Log 遺漏的舊資料，但沒有 Log 就沒有
  // sha256Checksum 可比對，完整性驗證的把關程度會比較弱，這是已知限制。

  // V11.2.1 新增（對應指令「四、還原前必須先建立一份 Before_Update 或
  // Before_Restore 備份」「五、還原前備份失敗時，立即中止還原」）：
  // 沿用既有 BEFORE_UPDATE 類型與 Before_Update 資料夾（不新增資料夾
  // 架構），用 reason="BEFORE_RESTORE" 標記這是還原前的保護性備份。
  const versionLabel = await readFile(path.join(process.cwd(), "package.json"), "utf8")
    .then((content) => JSON.parse(content).version ?? "unknown")
    .catch(() => "unknown")
    .then((version) => `${version}-before-restore-${Date.now()}`);
  const preRestoreBackup = await createBackup({
    type: "BEFORE_UPDATE",
    executedByName: operator.name,
    executedByUserId: operator.id,
    isAutomatic: false,
    versionLabel,
    reason: "BEFORE_RESTORE",
  });
  if (!preRestoreBackup.ok) {
    return {
      ok: false,
      status: 500,
      error: `還原前保護性備份失敗，已中止還原（依規定備份失敗不得繼續還原）：${preRestoreBackup.error}`,
    };
  }

  let stagingDir: string | null = null;
  try {
    const accessToken = await getActiveAccessToken();
    const zipBuffer = await downloadFile(accessToken, input.googleDriveFileId);

    stagingDir = await mkdtemp(path.join(tmpdir(), "sanxuan-restore-"));
    const zipPath = path.join(stagingDir, "backup.zip");
    await writeFile(zipPath, zipBuffer);
    await execFileAsync("unzip", ["-o", zipPath, "-d", stagingDir]);

    const dumpPath = path.join(stagingDir, "database.dump");
    if (!existsSync(dumpPath)) {
      throw new Error("解壓縮後找不到 database.dump，已禁止還原（ZIP 內容不完整）");
    }
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("缺少環境變數 DATABASE_URL，無法還原資料庫");

    await execFileAsync(
      "pg_restore",
      ["--clean", "--if-exists", "--single-transaction", "--no-owner", "--no-privileges", "--dbname", databaseUrl, dumpPath],
      { maxBuffer: 1024 * 1024 * 256 }
    );

    await recordVersion({
      entityType: "SystemRestore",
      entityId: input.googleDriveFileId,
      action: "RESTORE",
      operatorName: operator.name,
      changeNote: `一鍵還原：${input.fileName}（還原前保護性備份：${preRestoreBackup.fileName}）`,
    });

    return { ok: true };
  } catch (err) {
    // V11.2.1 補強（對應指令「十五、6」）：pg_restore 是用
    // `--dbname <DATABASE_URL>` 呼叫的，失敗時 Node 的錯誤訊息可能整段
    // 包含這組連線字串（含密碼）——用跟 backup.ts 相同的 redactSensitive()
    // 過濾後才儲存／回傳，避免密碼出現在還原失敗紀錄或畫面上。
    const message = redactSensitive(err instanceof Error ? err.message : String(err));
    // 還原失敗時也留一筆紀錄，方便系統健康檢查/Log 畫面追查。
    try {
      await recordVersion({
        entityType: "SystemRestore",
        entityId: input.googleDriveFileId,
        action: "RESTORE",
        operatorName: operator.name,
        changeNote: `一鍵還原失敗：${input.fileName}｜原因：${message}`,
      });
    } catch {
      // 連記錄都失敗就放棄，不要讓記錄本身的錯誤蓋掉真正的還原錯誤訊息。
    }
    return { ok: false, status: 500, error: `還原失敗：${message}` };
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true });
  }
}
