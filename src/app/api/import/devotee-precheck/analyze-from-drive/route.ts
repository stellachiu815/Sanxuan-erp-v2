/**
 * V30.1「從 Google Drive 同步信眾資料」——固定讀取「三玄宮ERP／匯入資料／信眾資料.xlsx」的最新修改版，
 * 下載後跑既有的信眾（Member）校正分析，回傳與 /analyze（correctionOnly）相同形狀的預覽 payload。
 *
 * ⚠️ 只從「匯入資料」讀取，**絕不**從備份（三玄宮ERP_Backup／Daily／Weekly／Monthly／Before_Update）讀取。
 * 只同步信眾（Member）。**完全不動** Household／歷代祖先／乙位正魂／報名／收款／列印／財務——
 * 沿用 correctionOnly 分析與 commit 保護。
 */
import { NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import {
  getActiveAccessToken,
  ensureImportFolder,
  findFileByName,
  downloadDriveFileAsXlsx,
  DEVOTEE_SHEET_FILE_NAME,
  IMPORT_ROOT_FOLDER_NAME,
  IMPORT_SUBFOLDER_NAME,
} from "@/lib/googleDrive";
import { analyzeCorrectionFromBuffer } from "@/lib/devoteeCorrectionSync";

const DRIVE_PATH = `${IMPORT_ROOT_FOLDER_NAME}／${IMPORT_SUBFOLDER_NAME}／${DEVOTEE_SHEET_FILE_NAME}`;

export const maxDuration = 120;

export async function POST(request: Request) {
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  // 1) 取得有效的 Google Drive access token（未串接/憑證失效時回明確錯誤）。
  let accessToken: string;
  try {
    accessToken = await getActiveAccessToken();
  } catch (err) {
    console.error("信眾同步：取得 Google Drive 存取權失敗", err);
    return NextResponse.json(
      { error: "尚未連接 Google Drive 或授權已失效，請先到系統中心的 Google Drive 連線重新授權。" },
      { status: 400 }
    );
  }

  // 2) 確認（不存在就自動建立）「三玄宮ERP／匯入資料」資料夾（不建立空白 Excel），找最新修改的「信眾資料.xlsx」。
  let found;
  try {
    const { importFolderId } = await ensureImportFolder(accessToken);
    found = await findFileByName(accessToken, importFolderId, DEVOTEE_SHEET_FILE_NAME);
    if (!found) {
      return NextResponse.json({ error: `Google Drive 找不到：${DRIVE_PATH}` }, { status: 404 });
    }
  } catch (err) {
    console.error("信眾同步：尋找 Google Drive 匯入檔失敗", err);
    return NextResponse.json({ error: "讀取 Google Drive 匯入資料夾失敗，請稍後再試。" }, { status: 502 });
  }

  // 3) 下載最新版 buffer（一般 xlsx→alt=media；Google 試算表→export 成 xlsx）。
  let buffer: Buffer;
  try {
    buffer = await downloadDriveFileAsXlsx(accessToken, found.id, found.mimeType);
  } catch (err) {
    console.error("信眾同步：下載 Google Drive 檔案失敗", err);
    return NextResponse.json({ error: "從 Google Drive 下載信眾資料失敗，請稍後再試。" }, { status: 502 });
  }

  // 4) 跑既有校正分析（correctionOnly）——與本機上傳同一支核心。
  const result = await analyzeCorrectionFromBuffer(found.name || DEVOTEE_SHEET_FILE_NAME, buffer);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  // 回傳來源檔資訊（需求五：預覽顯示檔名／最後修改時間／檔案 ID，不可靜默選錯檔）。
  return NextResponse.json({
    ...result.payload,
    source: "google-drive",
    driveFile: {
      path: DRIVE_PATH,
      id: found.id,
      name: found.name,
      modifiedTime: found.modifiedTime,
      matchCount: found.matchCount,
      isGoogleSheet: found.mimeType === "application/vnd.google-apps.spreadsheet",
    },
  });
}
