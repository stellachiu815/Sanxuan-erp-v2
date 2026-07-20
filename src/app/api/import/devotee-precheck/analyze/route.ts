/**
 * V11.3「信眾資料匯入預檢中心」——第一步：上傳檔案＋欄位對照，產生預覽
 * （不寫入任何 Household／Member 正式資料，只會建立 ImportBatch/ImportRow
 * 的「PREVIEWED」預覽紀錄）。
 *
 * POST /api/import/devotee-precheck/analyze  （multipart/form-data）
 *   file: 家戶 Excel（正式七欄），.xlsx/.xls/.csv（見 MAX_UPLOAD_FILE_BYTES 大小限制）
 *   personFile（V12.6 新增，選填）: 個人資料 Excel，用來補足每位成員的
 *     手機／市話／Email／生日／地址。它**不會產生自己的匯入列**，只是掛回
 *     家戶列的成員上，讓成員比對可以做多欄判斷（見 devoteeImportPersonSheet.ts）。
 *   mapping（選填，JSON 字串）: 使用者手動調整過的欄位對應
 *     例如 {"戶號":"householdCode","戶名":"householdName"}；不帶的話系統會
 *     用已儲存的欄位對應記憶＋別名表自動猜（見 smartImport.ts）。
 *   operatorUserId: 目前操作人員（伺服器端權限檢查用，需求確認「補上
 *     現有 /import 頁面的權限缺口」——這裡從一開始就要求 SUPER_ADMIN）。
 *
 * 回傳的 mapping 是「這次實際使用」的完整對應，前端讓使用者確認/調整後，
 * 直接把最終 mapping 存進批次（見 analyzeDevoteeImport 的 rawData），不需要
 * 使用者重新上傳檔案就能重跑分析——如果使用者在欄位對照步驟調整了對應，
 * 前端應該再呼叫一次這支 API（同一個檔案 buffer 由前端保留），不會沿用
 * 舊的批次。
 */
import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { parseSpreadsheetBuffer, suggestColumnMapping, saveFieldMapping, getTargetFields } from "@/lib/smartImport";
import { analyzeDevoteeImport, DEVOTEE_IMPORT_KIND, MAX_UPLOAD_FILE_BYTES, hasAllowedUploadExtension } from "@/lib/devoteeImportBatch";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "無法讀取上傳內容，請重新選擇檔案" }, { status: 400 });
  }

  const operatorUserIdRaw = formData.get("operatorUserId");
  const check = await assertSystemPermissionForOperator(
    typeof operatorUserIdRaw === "string" ? operatorUserIdRaw : null,
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "請選擇要上傳的 Excel／CSV 檔案" }, { status: 400 });
  }
  const uploadedFile = file as File;

  const fileName = uploadedFile.name || "excel";
  if (!hasAllowedUploadExtension(fileName)) {
    return NextResponse.json(
      { error: `不支援的檔案格式「${fileName}」，請上傳 .xlsx、.xls 或 .csv 檔案` },
      { status: 400 }
    );
  }
  if (uploadedFile.size > MAX_UPLOAD_FILE_BYTES) {
    const limitMb = (MAX_UPLOAD_FILE_BYTES / (1024 * 1024)).toFixed(0);
    return NextResponse.json(
      { error: `檔案太大（${(uploadedFile.size / (1024 * 1024)).toFixed(1)}MB），單次上傳檔案不能超過 ${limitMb}MB` },
      { status: 400 }
    );
  }

  let columns: string[];
  let rows: Record<string, unknown>[];
  try {
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    ({ columns, rows } = parseSpreadsheetBuffer(buffer));
  } catch (err) {
    console.error("信眾資料匯入預檢：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel（.xlsx/.xls）或 CSV 檔" }, { status: 400 });
  }

  if (columns.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: "檔案裡沒有資料列（標題列下面沒有內容），請確認檔案內容" }, { status: 400 });
  }

  const manualMappingRaw = formData.get("mapping");
  let manualMapping: Record<string, string | null> = {};
  if (typeof manualMappingRaw === "string" && manualMappingRaw) {
    try {
      manualMapping = JSON.parse(manualMappingRaw);
    } catch {
      return NextResponse.json({ error: "欄位對應格式錯誤，請重新選擇欄位" }, { status: 400 });
    }
  }

  const suggested = await suggestColumnMapping(DEVOTEE_IMPORT_KIND, columns);
  const mapping = { ...suggested, ...manualMapping };

  // 使用者這次手動調整過的欄位對應，存成記憶，下次上傳同樣欄位名稱的檔案可以直接帶出。
  for (const [col, target] of Object.entries(manualMapping)) {
    if (target) await saveFieldMapping(DEVOTEE_IMPORT_KIND, col, target);
  }

  // V12.6 指令四／五：可選的第二份「個人資料 Excel」。
  let personRows: Record<string, unknown>[] | undefined;
  let personFileName: string | null = null;
  const personFile = formData.get("personFile");
  if (personFile && typeof personFile !== "string") {
    const pf = personFile as File;
    personFileName = pf.name || "person";
    if (!hasAllowedUploadExtension(personFileName)) {
      return NextResponse.json(
        { error: `個人資料檔格式不支援「${personFileName}」，請上傳 .xlsx、.xls 或 .csv 檔案` },
        { status: 400 }
      );
    }
    if (pf.size > MAX_UPLOAD_FILE_BYTES) {
      const limitMb = (MAX_UPLOAD_FILE_BYTES / (1024 * 1024)).toFixed(0);
      return NextResponse.json(
        { error: `個人資料檔太大（${(pf.size / (1024 * 1024)).toFixed(1)}MB），不能超過 ${limitMb}MB` },
        { status: 400 }
      );
    }
    try {
      const buf = Buffer.from(await pf.arrayBuffer());
      personRows = parseSpreadsheetBuffer(buf).rows;
    } catch (err) {
      console.error("信眾資料匯入預檢：讀取個人資料檔失敗", err);
      return NextResponse.json(
        { error: "無法讀取個人資料檔，請確認是有效的 Excel（.xlsx/.xls）或 CSV 檔" },
        { status: 400 }
      );
    }
  }

  const { batchId, summary, rows: analyzedRows } = await analyzeDevoteeImport(
    fileName,
    rows,
    mapping,
    personRows
  );

  return NextResponse.json({
    batchId,
    fileName,
    personFileName,
    personRowCount: personRows?.length ?? 0,
    columns,
    mapping,
    targetFields: getTargetFields(DEVOTEE_IMPORT_KIND),
    summary,
    rows: analyzedRows,
  });
}
