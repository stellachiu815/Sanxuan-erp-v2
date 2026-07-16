import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { prisma } from "@/lib/prisma";
import {
  analyzeImport,
  commitImport,
  parseSpreadsheetBuffer,
  saveFieldMapping,
  type ImportDecision,
  type ImportKind,
} from "@/lib/smartImport";

/**
 * 活動精靈 Step3③「Excel／CSV匯入」——第二步：確認匯入，真正寫入資料。
 *
 * POST /api/temple-events/xxx/import/commit  （multipart/form-data）
 *   file: 跟 analyze 那一步同一個檔案（本輪採無狀態設計，重新上傳同一份
 *         檔案 + 確認後的欄位對應，不需要依賴伺服器保留上一步的分析結果）
 *   mapping（JSON 字串）: 使用者確認/調整過的完整欄位對應
 *   decisions（選填，JSON 字串）: 覆蓋個別列的匯入/略過決定，
 *     例如 {"5":"SKIP","9":"IMPORT"}（key 是列號）
 *   operatorName（選填）
 *
 * 會把這次的欄位對應存成永久記憶（需求「八」：設定一次即可永久保存），
 * 之後同一個活動類型、同樣的 Excel 欄位名稱就不用再手動選一次。
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const event = await prisma.templeEvent.findUnique({ where: { id } });
  if (!event) {
    return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });
  }
  const importKind: ImportKind = event.activityType === "PURIFICATION" ? "PURIFICATION" : "GENERIC_ACTIVITY";

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "請選擇要上傳的 Excel／CSV 檔案" }, { status: 400 });
  }

  const mappingRaw = formData?.get("mapping");
  let mapping: Record<string, string | null> = {};
  if (typeof mappingRaw === "string" && mappingRaw) {
    try {
      mapping = JSON.parse(mappingRaw);
    } catch {
      return NextResponse.json({ error: "欄位對應格式錯誤" }, { status: 400 });
    }
  }

  const decisionsRaw = formData?.get("decisions");
  let decisions: Record<number, ImportDecision> = {};
  if (typeof decisionsRaw === "string" && decisionsRaw) {
    try {
      const parsed = JSON.parse(decisionsRaw) as Record<string, ImportDecision>;
      decisions = Object.fromEntries(Object.entries(parsed).map(([k, v]) => [Number(k), v]));
    } catch {
      // 忽略格式錯誤，退回預設決定
    }
  }

  const operatorName = typeof formData?.get("operatorName") === "string" ? String(formData.get("operatorName")) : null;

  let columns: string[];
  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    ({ columns, rows } = parseSpreadsheetBuffer(buffer));
  } catch (err) {
    console.error("智慧匯入：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel/CSV 檔" }, { status: 400 });
  }

  // 存成永久欄位對應記憶（需求「八」）：只存「這次真的對應到某個 ERP 欄位」的項目。
  for (const col of columns) {
    const target = mapping[col];
    if (target) await saveFieldMapping(importKind, col, target);
  }

  const analysis = await analyzeImport(importKind, id, columns, rows, mapping);
  const result = await commitImport(importKind, id, analysis.rows, decisions, operatorName);

  return NextResponse.json(result);
}
