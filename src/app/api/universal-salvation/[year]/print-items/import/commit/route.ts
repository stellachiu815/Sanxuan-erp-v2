import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { parseSpreadsheetBuffer, suggestColumnMapping, saveFieldMapping } from "@/lib/smartImport";
import {
  analyzeAdditionalPrintItemImport,
  commitAdditionalPrintItemImport,
} from "@/lib/additionalPrintItems";

import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
/**
 * V9.1「附加列印項目」Excel/CSV 匯入方式二（明細工作表）——第二步：確認
 * 匯入，真正寫入資料（需求「八」：需先預覽，使用者確認後才真正寫入）。
 *
 * POST /api/universal-salvation/115/print-items/import/commit （multipart/form-data）
 *   file: 跟 analyze 那一步同一個檔案（無狀態設計，見
 *         /api/temple-events/xxx/import/commit 的既有慣例）
 *   mapping（JSON 字串）: 使用者確認/調整過的完整欄位對應
 *   decisions（選填，JSON 字串）: 覆蓋個別列的匯入/略過決定，
 *     例如 {"5":"SKIP","9":"IMPORT"}（key 是列號；沒有明確覆蓋的列，
 *     NEW 狀態預設匯入，其餘（DUPLICATE/MISSING_DATA/NEEDS_CONFIRMATION）
 *     預設略過，需求「八」：找不到來源資料的列不會被直接匯入）
 *   operatorName（選填）
 */
export async function POST(request: Request, { params }: { params: Promise<{ year: string }> }) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "create");
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
  let decisions: Record<number, "IMPORT" | "SKIP"> = {};
  if (typeof decisionsRaw === "string" && decisionsRaw) {
    try {
      const parsed = JSON.parse(decisionsRaw) as Record<string, "IMPORT" | "SKIP">;
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
    console.error("附加列印項目匯入：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel/CSV 檔" }, { status: 400 });
  }

  // 存成永久欄位對應記憶（跟 /api/temple-events/xxx/import/commit 同樣的慣例）。
  for (const col of columns) {
    const target = mapping[col];
    if (target) await saveFieldMapping("ADDITIONAL_PRINT_ITEM", col, target);
  }

  // mapping 若有缺漏（例如前端只傳了手動調整過的部分），用自動建議補齊。
  const suggested = await suggestColumnMapping("ADDITIONAL_PRINT_ITEM", columns);
  const fullMapping = { ...suggested, ...mapping };

  const analysis = await analyzeAdditionalPrintItemImport(year, rows, fullMapping);
  const result = await commitAdditionalPrintItemImport(year, analysis.rows, decisions, operatorName);

  return NextResponse.json(result);
}
