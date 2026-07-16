import crypto from "node:crypto";
import { prisma } from "@/lib/prisma";

/**
 * V11.2「系統管理中心 — Google Drive 固定綁定」（對應指令「二」「三」）。
 *
 * 【設計決定：不使用 `googleapis` 這個官方 Node 套件，改用內建 `fetch`
 * 直接呼叫 Google 的 REST API】
 * `googleapis` 套件體積很大、涵蓋所有 Google API，但這裡只需要少數幾個
 * 操作（OAuth token 交換/更新、資料夾建立/查詢、檔案上傳/下載/列表/刪除）。
 * Next.js 的伺服器執行環境本身就內建 `fetch`（Node 18+），直接呼叫這幾支
 * REST API 不需要新增任何 npm 套件——這在目前「沙盒完全無法 npm
 * install」的處境下是刻意的選擇：這部分程式碼不依賴任何新套件，一旦部署
 * 到有網路的正式環境，只要 Next.js/React/Prisma 這些原本就有的套件裝得起
 * 來，這部分就能動，不會因為「多裝一個 googleapis 失敗」而卡住。
 *
 * 【權杖（token）安全性】
 * refresh token 用 Node 內建 crypto 的 AES-256-GCM 加密後才存進資料庫
 * （`GoogleDriveConnection.refreshTokenCipher`），金鑰來自環境變數
 * `GOOGLE_TOKEN_ENCRYPTION_KEY`（需求是 32 bytes，可用
 * `openssl rand -hex 32` 產生）。access token 不落地保存，每次需要時都
 * 用 refresh token 換一個新的直接用，用完即丟，降低外洩風險。
 *
 * 【誠實揭露：這個沙盒完全無法測試這份程式碼的實際執行】
 * accounts.google.com／oauth2.googleapis.com／www.googleapis.com 在這個
 * 沙盒環境一律回傳 403（跟 npm/PyPI/GitHub 是同一個網路政策），所以這裡
 * 面每一個函式都只能靠程式碼審查（比對 Google 官方文件的 REST API 規格）
 * 確保呼叫方式正確，無法在這個環境實際送出請求驗證。詳見交付報告。
 */

const OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";
// 使用 drive.file（最小權限原則）：這個 scope 只能存取「這個 App 自己
// 建立或使用者明確用 App 開啟過」的檔案，不是完整 Google Drive 存取權——
// 對備份這個用途來說已經足夠（所有備份資料夾/檔案都是這個 App 自己建立
// 的），沒有必要要求使用者授權完整雲端硬碟的讀寫權限。

const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_UPLOAD_API = "https://www.googleapis.com/upload/drive/v3/files";

const ROOT_FOLDER_NAME = "三玄宮ERP_Backup";
const SUBFOLDER_NAMES = {
  dailyFolderId: "Daily",
  weeklyFolderId: "Weekly",
  monthlyFolderId: "Monthly",
  beforeUpdateFolderId: "Before_Update",
} as const;

function getEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `缺少環境變數 ${name}——請先依「V11.2_Google雲端硬碟串接設定說明.md」在 Google Cloud Console 建立 OAuth 用戶端並設定這個環境變數`
    );
  }
  return value;
}

// ------------------------------------------------------------------
// 權杖加解密（AES-256-GCM，Node 內建 crypto，不需要任何新套件）
// ------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  const raw = getEnv("GOOGLE_TOKEN_ENCRYPTION_KEY");
  // 允許 hex 或 base64 兩種格式，長度都要對應到 32 bytes（AES-256）。
  const buf = /^[0-9a-fA-F]{64}$/.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (buf.length !== 32) {
    throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY 必須是 32 bytes（64 位 hex 或對應長度的 base64）");
  }
  return buf;
}

export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  // 格式：base64(iv) . base64(authTag) . base64(ciphertext)
  return `${iv.toString("base64")}.${authTag.toString("base64")}.${encrypted.toString("base64")}`;
}

export function decryptSecret(ciphertext: string): string {
  const key = getEncryptionKey();
  const [ivB64, authTagB64, dataB64] = ciphertext.split(".");
  if (!ivB64 || !authTagB64 || !dataB64) {
    throw new Error("refresh token 密文格式不正確，無法解密");
  }
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(authTagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
}

// ------------------------------------------------------------------
// OAuth2 流程
// ------------------------------------------------------------------

/**
 * 產生「連結 Google Drive」按鈕要導向的 Google 授權網址。
 * `state` 用來做 CSRF 防護（一次性亂數，callback 時比對）。
 *
 * `login_hint` 只是「預先帶入建議帳號」的使用體驗優化（讓管理員在 Google
 * 登入畫面上少打一次帳號），不是安全機制——即使使用者在 Google 那邊改用
 * 別的帳號登入完成授權，系統一樣會照實記錄「實際完成授權的那個帳號」，
 * 不會假裝一定是 fa0225234163@gmail.com（見 handleOAuthCallback()）。
 */
export function buildAuthUrl(state: string, loginHint?: string): string {
  const params = new URLSearchParams({
    client_id: getEnv("GOOGLE_OAUTH_CLIENT_ID"),
    redirect_uri: getEnv("GOOGLE_OAUTH_REDIRECT_URI"),
    response_type: "code",
    scope: OAUTH_SCOPE,
    access_type: "offline", // 要求拿到 refresh_token，長期使用
    prompt: "consent", // 每次都強制出現同意畫面，確保拿得到 refresh_token
    include_granted_scopes: "true",
    state,
  });
  if (loginHint) params.set("login_hint", loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
};

/** 用授權碼換 access_token／refresh_token（OAuth2 authorization_code flow）。 */
async function exchangeCodeForTokens(code: string): Promise<GoogleTokenResponse> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: getEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      redirect_uri: getEnv("GOOGLE_OAUTH_REDIRECT_URI"),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google OAuth 換取權杖失敗：HTTP ${res.status} ${body}`);
  }
  return res.json();
}

/** 用 refresh_token 換一個新的 access_token（每次要呼叫 Drive API 前都先換一次，不快取）。 */
async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getEnv("GOOGLE_OAUTH_CLIENT_ID"),
      client_secret: getEnv("GOOGLE_OAUTH_CLIENT_SECRET"),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Google access token 更新失敗：HTTP ${res.status} ${body}`);
  }
  const data: GoogleTokenResponse = await res.json();
  return data.access_token;
}

/**
 * 查詢目前授權帳號的 email（用來顯示「目前綁定帳號」，也用來確認授權有效）。
 *
 * V11.2.1 補強（對應指令「三」）：如果 Google API 呼叫失敗、或回應裡
 * 沒有 emailAddress 欄位，**不得自行猜測或寫死帳號**，回傳 null，
 * 讓呼叫端（handleOAuthCallback）把 boundEmail 存成 null，畫面上顯示
 * 「已連線，但尚未取得帳號識別資料」，而不是編造一個看起來像帳號的字串。
 */
async function getAuthorizedEmail(accessToken: string): Promise<string | null> {
  try {
    const res = await fetch(`${DRIVE_API}/about?fields=user(emailAddress)`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.user?.emailAddress ?? null;
  } catch {
    return null;
  }
}

/**
 * OAuth callback 處理：換到 tokens 後，立即用實際拿到的 refresh_token
 * 建好資料夾結構、查出真實 email，一次性把
 * `GoogleDriveConnection`（id="SINGLETON"）整列寫好，狀態設為
 * CONNECTED——之後每日自動備份固定用這個資料庫紀錄，不受 Chrome 目前
 * 登入帳號影響（需求「二」的核心要求）。
 */
export async function handleOAuthCallback(code: string, operatorName: string) {
  const tokens = await exchangeCodeForTokens(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google 沒有回傳 refresh_token（通常是因為這個帳號之前已經同意過、Google 這次省略了）。" +
        "請先到 https://myaccount.google.com/permissions 撤銷這個 App 的既有授權，再重新連結一次。"
    );
  }
  const email = await getAuthorizedEmail(tokens.access_token);
  const folders = await ensureFolderStructure(tokens.access_token);
  const now = new Date();

  await prisma.googleDriveConnection.upsert({
    where: { id: "SINGLETON" },
    create: {
      id: "SINGLETON",
      boundEmail: email,
      refreshTokenCipher: encryptSecret(tokens.refresh_token),
      status: "CONNECTED",
      lastError: null,
      connectedAt: now,
      connectedByName: operatorName,
      lastVerifiedAt: now,
      ...folders,
    },
    update: {
      boundEmail: email,
      refreshTokenCipher: encryptSecret(tokens.refresh_token),
      status: "CONNECTED",
      lastError: null,
      connectedAt: now,
      connectedByName: operatorName,
      lastVerifiedAt: now,
      ...folders,
    },
  });

  // 對應指令「十五、8. 所有敏感操作都需寫入稽核紀錄」。連線本身沒有一個
  // 天然的「操作對象 id」，用固定字串 "GoogleDriveConnection" 當
  // entityId，記錄下這是誰、什麼時候完成的連結、綁定到哪個帳號
  // （email 為 null 時忠實記錄「未取得帳號」，不假裝有一個帳號）。
  const { recordVersion } = await import("@/lib/recordVersion");
  await recordVersion({
    entityType: "SystemGoogleDriveConnection",
    entityId: "SINGLETON",
    action: "RESTORE", // 沿用既有 RecordVersionAction 列舉裡最接近「狀態變更」語意的既有值，不新增列舉值
    operatorName,
    changeNote: email ? `連結 Google Drive 成功，綁定帳號：${email}` : "連結 Google Drive 成功，但未能取得帳號 Email",
  }).catch(() => {
    // 稽核記錄失敗不應該讓「已經成功完成的連線」被回滾或視為失敗。
  });

  return { email, folders };
}

/** 解除 Google Drive 授權（需求「二」：管理員可以「解除授權」）。 */
export async function disconnectGoogleDrive(operatorName?: string) {
  const before = await prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } });
  await prisma.googleDriveConnection.upsert({
    where: { id: "SINGLETON" },
    create: { id: "SINGLETON", status: "DISCONNECTED" },
    update: {
      status: "DISCONNECTED",
      refreshTokenCipher: null,
      boundEmail: null,
      lastError: null,
    },
  });

  if (operatorName) {
    const { recordVersion } = await import("@/lib/recordVersion");
    await recordVersion({
      entityType: "SystemGoogleDriveConnection",
      entityId: "SINGLETON",
      action: "RESTORE",
      operatorName,
      changeNote: `解除 Google Drive 授權（原綁定帳號：${before?.boundEmail ?? "未知"}）`,
    }).catch(() => {});
  }
}

/** Google Drive 網頁版資料夾連結（「開啟 Google Drive 備份資料夾」按鈕用）。 */
export function folderWebViewLink(folderId: string): string {
  return `https://drive.google.com/drive/folders/${folderId}`;
}

/** Google Drive 網頁版檔案連結（備份 Log「開啟 Google Drive」按鈕用）。 */
export function fileWebViewLink(fileId: string): string {
  return `https://drive.google.com/file/d/${fileId}/view`;
}

/**
 * 取得目前有效的 access token（每次呼叫都用資料庫存的 refresh token
 * 換一個新的），供備份/還原/健康檢查等函式使用。
 * 找不到有效連線或換權杖失敗時，會把連線狀態標記為 ERROR 並記下原因，
 * 方便「系統健康檢查」畫面顯示（需求「十三」）。
 */
export async function getActiveAccessToken(): Promise<string> {
  const conn = await prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } });
  if (!conn || conn.status !== "CONNECTED" || !conn.refreshTokenCipher) {
    throw new Error("GOOGLE_DRIVE_NOT_CONNECTED：尚未連結 Google Drive，請先到「Google Drive連線」頁面完成連結");
  }
  try {
    const refreshToken = decryptSecret(conn.refreshTokenCipher);
    const accessToken = await refreshAccessToken(refreshToken);
    // V11.2.1 新增（對應指令「三、清楚顯示最近一次成功驗證時間」）：
    // 每一次成功換到 access token（不論是備份觸發的，還是使用者按
    // 「測試連線」觸發的），都代表這組 refresh token「現在確實還有效」，
    // 忠實更新這個時間戳，不是另外模擬一個假的驗證動作。
    await prisma.googleDriveConnection.update({
      where: { id: "SINGLETON" },
      data: { lastVerifiedAt: new Date(), status: "CONNECTED", lastError: null },
    });
    return accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.googleDriveConnection.update({
      where: { id: "SINGLETON" },
      data: { status: "ERROR", lastError: message },
    });
    throw new Error(`TOKEN_REFRESH_FAILED：Google access token 換發失敗：${message}`);
  }
}

// ------------------------------------------------------------------
// 資料夾結構（需求「三」：固定存放於 三玄宮ERP_Backup/Daily|Weekly|Monthly|Before_Update）
// ------------------------------------------------------------------

async function findFolderByName(accessToken: string, name: string, parentId?: string): Promise<string | null> {
  const q = [
    `name = '${name.replace(/'/g, "\\'")}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    "trashed = false",
    parentId ? `'${parentId}' in parents` : "'root' in parents",
  ].join(" and ");
  const res = await fetch(`${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`查詢 Google Drive 資料夾失敗：HTTP ${res.status}`);
  const data = await res.json();
  return data.files?.[0]?.id ?? null;
}

async function createFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const res = await fetch(`${DRIVE_API}/files`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: parentId ? [parentId] : undefined,
    }),
  });
  if (!res.ok) throw new Error(`建立 Google Drive 資料夾失敗：HTTP ${res.status}`);
  const data = await res.json();
  return data.id;
}

async function findOrCreateFolder(accessToken: string, name: string, parentId?: string): Promise<string> {
  const existing = await findFolderByName(accessToken, name, parentId);
  if (existing) return existing;
  return createFolder(accessToken, name, parentId);
}

/**
 * 確認（不存在就自動建立）三玄宮ERP_Backup 與其下 4 個子資料夾
 * （需求「三」：「不得要求使用者手動建立資料夾」）。
 */
export async function ensureFolderStructure(accessToken: string) {
  const rootFolderId = await findOrCreateFolder(accessToken, ROOT_FOLDER_NAME);
  const folders: Record<string, string> = { rootFolderId };
  for (const [key, name] of Object.entries(SUBFOLDER_NAMES)) {
    folders[key] = await findOrCreateFolder(accessToken, name, rootFolderId);
  }
  return folders as {
    rootFolderId: string;
    dailyFolderId: string;
    weeklyFolderId: string;
    monthlyFolderId: string;
    beforeUpdateFolderId: string;
  };
}

// ------------------------------------------------------------------
// 檔案上傳／列表／下載／刪除
// ------------------------------------------------------------------

export type DriveFileInfo = { id: string; name: string; size: number; createdTime: string };

/** 上傳一個檔案（例如備份 zip）到指定資料夾，回傳 Google Drive fileId。 */
export async function uploadFile(
  accessToken: string,
  folderId: string,
  fileName: string,
  fileBuffer: Buffer,
  mimeType = "application/zip"
): Promise<string> {
  const boundary = `sanxuan-erp-backup-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name: fileName, parents: [folderId] });

  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`
    ),
    fileBuffer,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`上傳到 Google Drive 失敗：HTTP ${res.status} ${errBody}`);
  }
  const data = await res.json();
  return data.id;
}

/** 列出某個資料夾裡的檔案（依建立時間新到舊），供還原中心瀏覽使用。 */
export async function listFilesInFolder(accessToken: string, folderId: string): Promise<DriveFileInfo[]> {
  const q = `'${folderId}' in parents and trashed = false`;
  const res = await fetch(
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}&fields=files(id,name,size,createdTime)&orderBy=createdTime desc&pageSize=200`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!res.ok) throw new Error(`列出 Google Drive 檔案失敗：HTTP ${res.status}`);
  const data = await res.json();
  return (data.files ?? []).map((f: { id: string; name: string; size?: string; createdTime: string }) => ({
    id: f.id,
    name: f.name,
    size: f.size ? Number(f.size) : 0,
    createdTime: f.createdTime,
  }));
}

/** 下載檔案內容（還原時使用）。 */
export async function downloadFile(accessToken: string, fileId: string): Promise<Buffer> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`從 Google Drive 下載檔案失敗：HTTP ${res.status}`);
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/** 刪除檔案（保留政策清除過舊的 Daily/Weekly 備份時使用）。 */
export async function deleteFile(accessToken: string, fileId: string): Promise<void> {
  const res = await fetch(`${DRIVE_API}/files/${fileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`刪除 Google Drive 檔案失敗：HTTP ${res.status}`);
  }
}

/** 系統健康檢查用：確認目前連線狀態＋能不能真的換到 access token。 */
export async function checkGoogleDriveHealth(): Promise<
  { connected: true; email: string } | { connected: false; reason: string }
> {
  const conn = await prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } });
  if (!conn || conn.status !== "CONNECTED" || !conn.refreshTokenCipher) {
    return { connected: false, reason: conn?.lastError ?? "尚未連結 Google Drive" };
  }
  try {
    await getActiveAccessToken();
    return { connected: true, email: conn.boundEmail ?? "" };
  } catch (err) {
    return { connected: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

// ------------------------------------------------------------------
// V11.2.1 新增：「測試連線」（對應指令「四」）
// ------------------------------------------------------------------

export type ConnectionTestItem = {
  key: string;
  label: string;
  ok: boolean;
  detail: string;
};

export type ConnectionTestResult = {
  ranAt: string;
  overallOk: boolean;
  items: ConnectionTestItem[];
};

/**
 * 需求「四」逐項執行、逐項回報，不是只顯示籠統的「連線失敗」。
 * 每一項失敗都不會讓後面的項目直接中止（除非確實是後面項目的前提不成立
 * ——例如拿不到 access token，後面所有需要呼叫 Drive API 的項目就只能
 * 標記為「因前一項失敗而略過」，這是誠實反映依賴關係，不是隱藏失敗）。
 */
export async function testGoogleDriveConnection(): Promise<ConnectionTestResult> {
  const items: ConnectionTestItem[] = [];
  const ranAt = new Date().toISOString();

  const conn = await prisma.googleDriveConnection.findUnique({ where: { id: "SINGLETON" } });
  if (!conn || conn.status === "DISCONNECTED") {
    items.push({ key: "connection", ok: false, label: "Google Drive 綁定狀態", detail: "尚未連結 Google Drive" });
    return { ranAt, overallOk: false, items };
  }

  // 1. 是否能取得有效 access token
  let accessToken: string | null = null;
  try {
    accessToken = await getActiveAccessToken();
    items.push({ key: "token", ok: true, label: "取得有效 access token", detail: "成功換發" });
  } catch (err) {
    items.push({
      key: "token",
      ok: false,
      label: "取得有效 access token",
      detail: err instanceof Error ? err.message : String(err),
    });
    const result: ConnectionTestResult = { ranAt, overallOk: false, items };
    await saveTestResult(result);
    return result;
  }

  // 2. 是否能呼叫 Google Drive API（用取得帳號資訊當作最基本的 API 呼叫測試）
  const email = await getAuthorizedEmail(accessToken);
  if (email) {
    items.push({ key: "api_call", ok: true, label: "呼叫 Google Drive API", detail: `成功，帳號：${email}` });
    items.push({ key: "account", ok: true, label: "取得目前綁定帳號資料", detail: email });
  } else {
    items.push({ key: "api_call", ok: false, label: "呼叫 Google Drive API", detail: "API 呼叫失敗或未回傳預期資料" });
    items.push({ key: "account", ok: false, label: "取得目前綁定帳號資料", detail: "已連線，但尚未取得帳號識別資料" });
  }

  // 3. 是否能讀取或建立備份根資料夾 + 4. 四個子資料夾
  try {
    const folders = await ensureFolderStructure(accessToken);
    items.push({ key: "root_folder", ok: true, label: "備份根資料夾（三玄宮ERP_Backup）", detail: `資料夾 ID：${folders.rootFolderId}` });
    for (const [key, name] of [
      ["dailyFolderId", "Daily"],
      ["weeklyFolderId", "Weekly"],
      ["monthlyFolderId", "Monthly"],
      ["beforeUpdateFolderId", "Before_Update"],
    ] as const) {
      const id = (folders as Record<string, string>)[key];
      items.push({ key, ok: !!id, label: `子資料夾（${name}）`, detail: id ? `資料夾 ID：${id}` : "無法取得資料夾 ID" });
    }

    // 6. 是否有檔案上傳權限：實際上傳一個極小的測試檔到根資料夾，
    // 成功後立刻刪除，不留下垃圾檔案——只有真的執行一次上傳＋刪除，
    // 才能誠實回答「有沒有上傳權限」，而不是用資料夾建立成功來推測。
    try {
      const testFileId = await uploadFile(
        accessToken,
        folders.rootFolderId,
        `_connection_test_${Date.now()}.txt`,
        Buffer.from("sanxuan-erp connection test", "utf8"),
        "text/plain"
      );
      await deleteFile(accessToken, testFileId);
      items.push({ key: "upload_permission", ok: true, label: "檔案上傳權限", detail: "測試檔上傳並刪除成功" });
    } catch (err) {
      items.push({
        key: "upload_permission",
        ok: false,
        label: "檔案上傳權限",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    items.push({ key: "root_folder", ok: false, label: "備份根資料夾（三玄宮ERP_Backup）", detail: message });
    for (const [key, name] of [
      ["dailyFolderId", "Daily"],
      ["weeklyFolderId", "Weekly"],
      ["monthlyFolderId", "Monthly"],
      ["beforeUpdateFolderId", "Before_Update"],
    ] as const) {
      items.push({ key, ok: false, label: `子資料夾（${name}）`, detail: "因根資料夾檢查失敗而略過" });
    }
    items.push({ key: "upload_permission", ok: false, label: "檔案上傳權限", detail: "因根資料夾檢查失敗而略過" });
  }

  const result: ConnectionTestResult = { ranAt, overallOk: items.every((i) => i.ok), items };
  await saveTestResult(result);
  return result;
}

async function saveTestResult(result: ConnectionTestResult): Promise<void> {
  await prisma.googleDriveConnection.update({
    where: { id: "SINGLETON" },
    data: { lastTestResult: JSON.stringify(result) },
  });
}

// ------------------------------------------------------------------
// V11.2.1 新增：錯誤分類（對應指令「八」，區分固定的錯誤類別，
// 不得只顯示「未知系統錯誤」）
//
// 實際邏輯搬到 src/lib/backupErrorClassifier.ts（一支完全不 import
// @prisma/client／next 的獨立檔案），純粹是為了能在沒有真正
// node_modules 的沙盒環境裡用 `npx tsx` 直接載入原始碼驗證；這裡只是
// re-export，維持其他檔案原本 `from "@/lib/googleDrive"` 的 import
// 路徑不需要跟著改（backup.ts 已改成直接從新檔案 import）。
// ------------------------------------------------------------------

export type { BackupErrorCode } from "@/lib/backupErrorClassifier";
export { classifyBackupError } from "@/lib/backupErrorClassifier";
