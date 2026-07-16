/**
 * V11.2.1 新增：備份錯誤分類（對應指令「八」，區分固定的錯誤類別，
 * 不得只顯示「未知系統錯誤」）。
 *
 * 這支檔案刻意獨立出來、不 import 任何依賴 @prisma/client／next 的模組
 * ——純粹的字串比對邏輯，這樣即使在這個沙盒（node_modules 是空的）也能
 * 用 `npx tsx` 直接載入真正的原始碼執行驗證，方法論跟 src/lib/permissions.ts
 * 一致（見 v11_1_1_verification/ 底下的驗證腳本）。
 */

export type BackupErrorCode =
  | "GOOGLE_DRIVE_NOT_CONNECTED"
  | "GOOGLE_AUTH_INVALID"
  | "TOKEN_REFRESH_FAILED"
  | "GOOGLE_DRIVE_NO_PERMISSION"
  | "FOLDER_CREATE_FAILED"
  | "PG_DUMP_NOT_FOUND"
  | "DATABASE_DUMP_FAILED"
  | "ZIP_CREATE_FAILED"
  | "UPLOAD_FAILED"
  | "DISK_SPACE_INSUFFICIENT"
  | "UNKNOWN_ERROR";

const ERROR_CODE_SUGGESTION: Record<BackupErrorCode, string> = {
  GOOGLE_DRIVE_NOT_CONNECTED: "請到【系統管理中心 → Google Drive連線】完成連結",
  GOOGLE_AUTH_INVALID: "請到【系統管理中心 → Google Drive連線】重新連結／重新授權",
  TOKEN_REFRESH_FAILED: "Google 授權可能已在 Google 帳號那端被撤銷，請重新連結",
  GOOGLE_DRIVE_NO_PERMISSION: "請確認 Google Drive 帳號沒有停用、且該帳號的雲端硬碟空間未滿",
  FOLDER_CREATE_FAILED: "請檢查 Google Drive 帳號空間或稍後再試，若持續發生請重新連結",
  PG_DUMP_NOT_FOUND: "部署環境缺少 pg_dump 指令，請參考交付報告改用支援 PostgreSQL 用戶端工具的部署方式（例如 Docker）",
  DATABASE_DUMP_FAILED: "請檢查資料庫連線字串（DATABASE_URL）是否正確、資料庫是否可連線",
  ZIP_CREATE_FAILED: "部署環境可能缺少 zip 指令，或暫存空間不足",
  UPLOAD_FAILED: "請檢查網路連線與 Google Drive 帳號空間，稍後再試",
  DISK_SPACE_INSUFFICIENT: "Render 服務暫存空間不足，請清理或升級方案",
  UNKNOWN_ERROR: "請查看完整錯誤訊息或聯絡開發人員",
};

/**
 * V11.2.1 新增（對應指令「十五、6. 錯誤訊息不得包含完整 DATABASE_URL」／
 * 「八、4. 保存必要的技術錯誤資訊，但不得在前端洩漏...資料庫連線密碼」）。
 *
 * 【發現的實際風險】backup.ts／restore.ts 呼叫 `pg_dump`／`pg_restore` 時，
 * 是把完整的 `DATABASE_URL`（可能包含帳號密碼，例如
 * `postgres://user:password@host:5432/db`）當作指令的其中一個參數傳入。
 * Node.js 的 `child_process.execFile` 在指令失敗時，拋出的錯誤物件的
 * `.message` 依慣例會整段包含「Command failed: <指令> <所有參數>」，也就是
 * 會把這組連線字串（含密碼）整段原文包在錯誤訊息裡——如果不處理，這段
 * 訊息接下來會被存進 BackupLog.failureReason，並且直接顯示在【系統管理
 * 中心 → 備份紀錄】畫面上，等於把資料庫密碼洩漏給任何看得到這個畫面的人。
 *
 * 這裡在任何錯誤訊息要被儲存／回傳給前端之前，先用正規表示式把看起來像
 * 資料庫連線字串的片段整段換成 `[已隱藏：資料庫連線字串]`，其餘錯誤說明
 * 文字（例如 pg_dump 印出的實際錯誤原因）維持不變，管理員仍然看得到足夠
 * 判斷問題的資訊，但不會看到密碼本身。
 */
export function redactSensitive(message: string): string {
  return message.replace(
    /(postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'\)]+/gi,
    "[已隱藏：資料庫連線字串]"
  );
}

/**
 * 依錯誤訊息內容＋（可選）發生階段分類成固定代碼。
 *
 * 需要帶 `stage` 的原因：Node 對「找不到指令」一律回傳同一種
 * `ENOENT` 錯誤，不會自己說是 pg_dump 還是 zip 找不到——如果只看訊息
 * 內容，「pg_dump 找不到」跟「zip 找不到」會被誤判成同一類。這裡改成
 * 優先依「當下卡在哪個階段」（見 src/lib/backup.ts 的 BACKUP_STAGE）
 * 判斷 ENOENT 屬於哪一種缺工具的情況，只有沒有階段資訊時才退回單純比對
 * 訊息內容；沒有比對到已知特徵一律歸類為 UNKNOWN_ERROR，並附上原始
 * 錯誤訊息，讓管理員自己判斷，不是憑空猜測。
 */
export function classifyBackupError(
  message: string,
  stage?: string
): { code: BackupErrorCode; suggestion: string } {
  const m = message;
  const test = (code: BackupErrorCode, ...patterns: string[]) =>
    patterns.some((p) => m.includes(p)) ? code : null;

  if (m.includes("ENOENT")) {
    if (stage === "DUMPING_DATABASE") return { code: "PG_DUMP_NOT_FOUND", suggestion: ERROR_CODE_SUGGESTION.PG_DUMP_NOT_FOUND };
    if (stage === "COMPRESSING") return { code: "ZIP_CREATE_FAILED", suggestion: ERROR_CODE_SUGGESTION.ZIP_CREATE_FAILED };
  }

  const code: BackupErrorCode =
    test("GOOGLE_DRIVE_NOT_CONNECTED", "GOOGLE_DRIVE_NOT_CONNECTED", "尚未連結 Google Drive") ??
    test("TOKEN_REFRESH_FAILED", "TOKEN_REFRESH_FAILED", "Google access token 更新失敗", "換發失敗") ??
    test("GOOGLE_AUTH_INVALID", "沒有回傳 refresh_token", "invalid_grant") ??
    test("GOOGLE_DRIVE_NO_PERMISSION", "HTTP 403", "insufficientPermissions", "storageQuotaExceeded") ??
    test("FOLDER_CREATE_FAILED", "建立 Google Drive 資料夾失敗", "查詢 Google Drive 資料夾失敗") ??
    test("PG_DUMP_NOT_FOUND", "ENOENT") ??
    test("DATABASE_DUMP_FAILED", "pg_dump", "DATABASE_URL", "缺少環境變數 DATABASE_URL") ??
    test("ZIP_CREATE_FAILED", "zip") ??
    test("UPLOAD_FAILED", "上傳到 Google Drive 失敗") ??
    test("DISK_SPACE_INSUFFICIENT", "ENOSPC", "no space left") ??
    "UNKNOWN_ERROR";

  return { code, suggestion: ERROR_CODE_SUGGESTION[code] };
}
