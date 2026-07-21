import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { parseSpreadsheetBuffer, suggestColumnMapping, getTargetFields } from "@/lib/smartImport";
import { analyzeAdditionalPrintItemImport } from "@/lib/additionalPrintItems";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * V9.1「附加列印項目」Excel/CSV 匯入方式二（明細工作表）——第一步：上傳
 * 檔案，分析新增/重複/缺少資料/待確認（需求「八」），純查詢，不寫入任何
 * 正式資料。找不到對應來源祭祀資料的列，一律列入待確認清單，不會直接
 * 匯入（見 src/lib/additionalPrintItems.ts 的 analyzeAdditionalPrintItemImport
 * 說明）。
 *
 * POST /api/universal-salvation/115/print-items/import/analyze （multipart/form-data）
 *   file: 上傳的 xlsx/xls/csv 檔案，欄位需符合「附加列印項目」明細工作表
 *         格式（家戶編號/報名人/原祭祀類型/原祭祀名稱/附加項目類型/
 *         列印名稱/數量/預設或額外/備註，見 src/lib/templates.ts 的
 *         ADDITIONAL_PRINT_ITEM_IMPORT 空白範本）
 *   mapping（選填，JSON 字串）: 使用者手動調整過的欄位對應
 */
export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

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
    console.error("附加列印項目匯入：讀取檔案失敗", err);
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

  const suggested = await suggestColumnMapping("ADDITIONAL_PRINT_ITEM", columns);
  const mapping = { ...suggested, ...manualMapping };

  const analysis = await analyzeAdditionalPrintItemImport(year, rows, mapping);

  return NextResponse.json({
    targetFields: getTargetFields("ADDITIONAL_PRINT_ITEM"),
    mapping,
    ...analysis,
  });
}
