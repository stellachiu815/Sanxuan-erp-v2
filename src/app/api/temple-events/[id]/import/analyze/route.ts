import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import {
  analyzeImport,
  parseSpreadsheetBuffer,
  suggestColumnMapping,
  getTargetFields,
  type ImportKind,
} from "@/lib/smartImport";
import { prisma } from "@/lib/prisma";

/**
 * 活動精靈 Step3③「Excel／CSV匯入」——第一步：上傳檔案，分析新增/更新/
 * 重複/缺少資料/待確認（需求「三」），純查詢，不寫入任何正式資料。
 *
 * POST /api/temple-events/xxx/import/analyze  （multipart/form-data）
 *   file: 上傳的 xlsx/xls/csv 檔案
 *   mapping（選填，JSON 字串）: 使用者手動調整過的欄位對應，
 *     例如 {"報名人姓名":"displayName","戶號":"householdId"}；
 *     不帶的話，系統會用已儲存的欄位對應記憶＋別名表自動猜。
 *
 * 回傳的 mapping 是「這次實際使用」的完整對應，前端可以讓使用者確認/調整
 * 之後，呼叫 saveFieldMapping（見 .../import/commit 的 body.confirmMapping）
 * 存成永久記憶。
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

  let columns: string[];
  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    ({ columns, rows } = parseSpreadsheetBuffer(buffer));
  } catch (err) {
    console.error("智慧匯入：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel/CSV 檔" }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "檔案裡沒有資料列（標題列下面沒有內容）" }, { status: 400 });
  }

  const manualMappingRaw = formData?.get("mapping");
  let manualMapping: Record<string, string | null> = {};
  if (typeof manualMappingRaw === "string" && manualMappingRaw) {
    try {
      manualMapping = JSON.parse(manualMappingRaw);
    } catch {
      // 忽略格式錯誤的手動對應，退回自動建議
    }
  }

  const suggested = await suggestColumnMapping(importKind, columns);
  const mapping = { ...suggested, ...manualMapping };

  const analysis = await analyzeImport(importKind, id, columns, rows, mapping);

  return NextResponse.json({
    importKind,
    targetFields: getTargetFields(importKind),
    ...analysis,
  });
}
