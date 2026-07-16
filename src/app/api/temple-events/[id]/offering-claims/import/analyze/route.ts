import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { parseSpreadsheetBuffer, suggestColumnMapping, getTargetFields } from "@/lib/smartImport";
import { analyzeOfferingClaimImport } from "@/lib/offeringImport";

/**
 * V10.1「供品認捐中心」需求「八」Excel/CSV 匯入——第一步：上傳檔案，分析
 * 每一列的狀態（OK/待確認/錯誤），純查詢不寫入。
 *
 * POST /api/temple-events/xxx/offering-claims/import/analyze （multipart/form-data）
 *   file: 上傳的 xlsx/xls/csv 檔案（見 src/lib/templates.ts 的
 *         OFFERING_CLAIM_IMPORT 空白範本）
 *   mapping（選填，JSON 字串）: 使用者手動調整過的欄位對應
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
    console.error("供品認捐匯入：讀取檔案失敗", err);
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

  const suggested = await suggestColumnMapping("OFFERING_CLAIM", columns);
  const mapping = { ...suggested, ...manualMapping };

  const analyzedRows = await analyzeOfferingClaimImport(id, rows, mapping);
  const okCount = analyzedRows.filter((r) => r.status === "OK").length;
  const needsConfirmCount = analyzedRows.filter((r) => r.status === "NEEDS_CONFIRMATION").length;
  const errorCount = analyzedRows.filter((r) => r.status === "ERROR").length;

  return NextResponse.json({
    targetFields: getTargetFields("OFFERING_CLAIM"),
    mapping,
    rows: analyzedRows,
    summary: { total: analyzedRows.length, okCount, needsConfirmCount, errorCount },
  });
}
