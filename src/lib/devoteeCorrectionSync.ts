/**
 * V30.1 信眾（Member）同步共用核心。
 *
 * 把一份「信眾資料 Excel」的 buffer 跑完既有的校正分析（correctionOnly=true），回傳與
 * /api/import/devotee-precheck/analyze 相同形狀的預覽 payload。**完全沿用**既有解析
 * （autoDetectHeader + 別名正規化）、姓名配對、生日換算、逐欄差異與安全更新規則，
 * 不重寫、不建立第二套流程。本機上傳與 Google Drive 同步共用這支，避免重複邏輯。
 */
import type { Buffer as NodeBuffer } from "node:buffer";
import { parseSpreadsheetBuffer, getTargetFields } from "@/lib/smartImport";
import { remapPersonSheetAliases } from "@/lib/devoteeImportPersonSheet";
import { analyzeDevoteeImport, DEVOTEE_IMPORT_KIND } from "@/lib/devoteeImportBatch";

export type CorrectionAnalyzeResult =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * 由 buffer 產生校正模式預覽。只做信眾（Member）比對／校正，完全不碰 Household／永久資料。
 */
export async function analyzeCorrectionFromBuffer(
  fileName: string,
  buffer: NodeBuffer
): Promise<CorrectionAnalyzeResult> {
  let personRows: Record<string, unknown>[] = [];
  let detectedColumns: string[] = [];
  try {
    // 只解析一次（autoDetectHeader）；別名欄名補成正式欄名。用完即釋放中間陣列。
    const detected = parseSpreadsheetBuffer(buffer, { autoDetectHeader: true });
    detectedColumns = detected.columns;
    personRows = remapPersonSheetAliases(detected.rows);
  } catch {
    return { ok: false, status: 400, error: "無法讀取這個檔案，請確認是有效的 Excel（.xlsx/.xls）或 CSV 檔" };
  }

  // 以「姓名」為配對主鍵；解析前只驗證能否辨識姓名欄，不得靜默回傳全 0。
  const withName = personRows.filter((r) => String(r["姓名"] ?? "").trim() !== "").length;
  if (personRows.length === 0 || withName === 0) {
    const detected = detectedColumns.join("、") || "（未偵測到欄名）";
    return {
      ok: false,
      status: 400,
      error: `無法辨識「姓名／信眾姓名」欄，請確認信眾 Excel 的標題列。實際偵測到的欄名：${detected}`,
    };
  }

  // 沿用既有校正分析（correctionOnly=true）：家戶列傳空、mapping 傳空（校正模式以 personRows 為準）。
  const { batchId, summary, rows, sheetPreparation, correctionDebug } = await analyzeDevoteeImport(
    fileName,
    [],
    {},
    personRows,
    true
  );

  return {
    ok: true,
    payload: {
      batchId,
      fileName,
      personFileName: null,
      personRowCount: 0,
      sheetPreparation,
      correctionDebug,
      columns: [],
      mapping: {},
      targetFields: getTargetFields(DEVOTEE_IMPORT_KIND),
      summary,
      rows,
    },
  };
}
