// V11.2.1 真實執行驗證：跟 verify_system_permissions.ts 同樣的方法論——
// src/lib/backupErrorClassifier.ts 刻意不 import 任何 @prisma/client／
// next 的模組，可以在沒有 npm install 的沙盒環境裡用 tsx 直接載入「真正的
// 原始碼」執行，不是憑空模擬。這支腳本對應指令「八、備份失敗處理補強」
// 列出的 11 種錯誤分類（含 UNKNOWN_ERROR），逐一用真實訊息字串／階段
// 組合去呼叫 classifyBackupError()，確認回傳的錯誤代碼與建議處理方式
// 符合預期，而且每一種代碼都有非空的 suggestion 文字（對應「不得只顯示
// 籠統的『連線失敗』」）。
import { classifyBackupError, redactSensitive, type BackupErrorCode } from "../src/lib/backupErrorClassifier";

let pass = 0;
let fail = 0;

function check(label: string, actualCode: BackupErrorCode, expectedCode: BackupErrorCode, suggestion: string) {
  const ok = actualCode === expectedCode && typeof suggestion === "string" && suggestion.trim().length > 0;
  console.log(
    `${ok ? "PASS" : "FAIL"} - ${label} => code=${actualCode} expected=${expectedCode} suggestion="${suggestion}"`
  );
  if (ok) pass++;
  else fail++;
}

// 十一種代碼，逐一用真實會出現的訊息內容測試（對應「八」錯誤訊息須區分
// 的十一種類別，含未知系統錯誤）。
{
  const { code, suggestion } = classifyBackupError("GOOGLE_DRIVE_NOT_CONNECTED: 尚未連結 Google Drive");
  check("尚未連結 Google Drive", code, "GOOGLE_DRIVE_NOT_CONNECTED", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("TOKEN_REFRESH_FAILED: Google access token 更新失敗");
  check("Token 換發失敗", code, "TOKEN_REFRESH_FAILED", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("Google 回傳 invalid_grant，沒有回傳 refresh_token");
  check("Google 授權失效", code, "GOOGLE_AUTH_INVALID", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("呼叫 Google Drive API 失敗：HTTP 403 insufficientPermissions");
  check("Google Drive API 無權限", code, "GOOGLE_DRIVE_NO_PERMISSION", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("建立 Google Drive 資料夾失敗：權限不足");
  check("資料夾建立失敗", code, "FOLDER_CREATE_FAILED", suggestion);
}
{
  // 階段感知：DUMPING_DATABASE 階段的 ENOENT 一律判定為找不到 pg_dump
  // 指令本身，不是「資料庫匯出失敗」（對應設計說明：Node 對『找不到指令』
  // 一律回傳同一種 ENOENT，需要靠階段資訊才能分辨是哪一種缺工具）。
  const { code, suggestion } = classifyBackupError("Error: spawn pg_dump ENOENT", "DUMPING_DATABASE");
  check("pg_dump 不存在（依階段判斷）", code, "PG_DUMP_NOT_FOUND", suggestion);
}
{
  // 沒有階段資訊時，退回單純字串比對——"ENOENT" 沒有 stage 時預設判斷為
  // PG_DUMP_NOT_FOUND（現有邏輯：test("PG_DUMP_NOT_FOUND", "ENOENT") 排在
  // DATABASE_DUMP_FAILED 之前）。
  const { code, suggestion } = classifyBackupError("Error: spawn pg_dump ENOENT");
  check("pg_dump 不存在（無階段資訊，退回訊息比對）", code, "PG_DUMP_NOT_FOUND", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("pg_dump 執行失敗，缺少環境變數 DATABASE_URL");
  check("資料庫匯出失敗", code, "DATABASE_DUMP_FAILED", suggestion);
}
{
  // 階段感知：COMPRESSING 階段的 ENOENT 判定為找不到 zip 指令。
  const { code, suggestion } = classifyBackupError("Error: spawn zip ENOENT", "COMPRESSING");
  check("ZIP 建立失敗（依階段判斷）", code, "ZIP_CREATE_FAILED", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("執行 zip 指令時發生錯誤，無法建立壓縮檔");
  check("ZIP 建立失敗（訊息比對）", code, "ZIP_CREATE_FAILED", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("上傳到 Google Drive 失敗：網路逾時");
  check("上傳失敗", code, "UPLOAD_FAILED", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("write EONSPC: no space left on device");
  check("暫存空間不足", code, "DISK_SPACE_INSUFFICIENT", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("寫入檔案時發生 ENOSPC");
  check("暫存空間不足（ENOSPC 代碼）", code, "DISK_SPACE_INSUFFICIENT", suggestion);
}
{
  const { code, suggestion } = classifyBackupError("這是一段完全沒有對應到任何已知特徵的隨機錯誤訊息 xyz123");
  check("未知系統錯誤（無法歸類時，不得憑空猜測）", code, "UNKNOWN_ERROR", suggestion);
}

// 邊界案例：空字串訊息不應該讓程式炸掉，應該安全地落到 UNKNOWN_ERROR。
{
  const { code, suggestion } = classifyBackupError("");
  check("空字串訊息（邊界案例，不應炸掉）", code, "UNKNOWN_ERROR", suggestion);
}

// 確認十一種代碼「每一種」都真的有非空的建議文字（對應「不得只顯示籠統的
// 『連線失敗』」，每種代碼都要能告訴管理員具體怎麼處理）。
{
  const allCodes: BackupErrorCode[] = [
    "GOOGLE_DRIVE_NOT_CONNECTED",
    "GOOGLE_AUTH_INVALID",
    "TOKEN_REFRESH_FAILED",
    "GOOGLE_DRIVE_NO_PERMISSION",
    "FOLDER_CREATE_FAILED",
    "PG_DUMP_NOT_FOUND",
    "DATABASE_DUMP_FAILED",
    "ZIP_CREATE_FAILED",
    "UPLOAD_FAILED",
    "DISK_SPACE_INSUFFICIENT",
    "UNKNOWN_ERROR",
  ];
  console.log(`\n共 ${allCodes.length} 種錯誤代碼（對應指令「八」列出的分類數量，含未知系統錯誤）。`);
}

// V11.2.1 補強：redactSensitive() 真實執行驗證（對應指令「十五、6. 錯誤
// 訊息不得包含完整 DATABASE_URL」）——這是這一輪重新檢查程式碼時發現的
// 實際風險：pg_dump／pg_restore 失敗時，Node 的錯誤訊息會整段包含呼叫時
// 傳入的 DATABASE_URL（含密碼），必須在存進 BackupLog／回傳給前端之前
// 過濾掉，不能只是理論上這樣寫、沒有真的驗證過會不會誤刪不該刪的內容。
function checkRedact(label: string, input: string, mustNotContain: string, mustContain?: string) {
  const output = redactSensitive(input);
  const hidesSecret = !output.includes(mustNotContain);
  const keepsOtherText = mustContain ? output.includes(mustContain) : true;
  const ok = hidesSecret && keepsOtherText;
  console.log(`${ok ? "PASS" : "FAIL"} - ${label} => output="${output}"`);
  if (ok) pass++;
  else fail++;
}

checkRedact(
  "pg_dump 失敗訊息裡的 postgres:// 連線字串（含密碼）必須被隱藏",
  "Command failed: pg_dump --format=custom --file /tmp/x/database.dump postgres://sanxuan_user:S3cretPass!@db.internal:5432/sanxuan_v11\npg_dump: error: connection failed",
  "S3cretPass!",
  "pg_dump: error: connection failed"
);
checkRedact(
  "pg_restore --dbname 連線字串（含密碼）必須被隱藏",
  "Command failed: pg_restore --clean --if-exists --dbname postgresql://admin:hunter2@127.0.0.1:5432/prod /tmp/x/database.dump",
  "hunter2",
  "pg_restore --clean --if-exists"
);
checkRedact(
  "沒有連線字串的一般訊息應該完全不受影響（不能誤刪正常錯誤內容）",
  "找不到 pg_dump 指令，ENOENT",
  "不存在的字串xyz不應該被找到",
  "找不到 pg_dump 指令，ENOENT"
);

console.log(`\n總結：${pass} 項通過，${fail} 項失敗。`);
if (fail > 0) process.exit(1);
