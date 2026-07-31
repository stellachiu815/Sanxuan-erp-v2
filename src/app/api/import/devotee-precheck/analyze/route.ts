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
import { readOperatorUserId } from "@/lib/requestOperator";
import { parseSpreadsheetBuffer, suggestColumnMapping, saveFieldMapping, getTargetFields } from "@/lib/smartImport";
import { remapPersonSheetAliases } from "@/lib/devoteeImportPersonSheet";
import { applyCanonicalDevoteeHouseholdMapping } from "@/lib/importFieldSuggestion";
import { annotateTabletRoutedColumns, TABLET_ROUTED_COLUMNS } from "@/lib/devoteeImportNormalize";
import { analyzeDevoteeImport, DEVOTEE_IMPORT_KIND, MAX_UPLOAD_FILE_BYTES, hasAllowedUploadExtension } from "@/lib/devoteeImportBatch";

export async function POST(request: Request) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "無法讀取上傳內容，請重新選擇檔案" }, { status: 400 });
  }

  const check = await assertSystemPermissionForOperator(
    await readOperatorUserId(request),
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

  // V29：信眾資料校正模式——上傳的檔案即為信眾（個人）Excel。
  const correctionOnly = formData.get("correctionOnly") === "true";

  let columns: string[];
  let rows: Record<string, unknown>[];
  // V29 校正模式：自動偵測標題列 + 欄名別名正規化後的信眾列（完整匯入不受影響）。
  let correctionPersonRows: Record<string, unknown>[] = [];
  let correctionDetectedColumns: string[] = [];
  try {
    const buffer = Buffer.from(await uploadedFile.arrayBuffer());
    ({ columns, rows } = parseSpreadsheetBuffer(buffer));
    if (correctionOnly) {
      // 自動找出真正標題列（前面可有標題文字/空白列/合併儲存格），再把別名欄名補成正式欄名。
      const detected = parseSpreadsheetBuffer(buffer, { autoDetectHeader: true });
      correctionDetectedColumns = detected.columns;
      correctionPersonRows = remapPersonSheetAliases(detected.rows);
    }
  } catch (err) {
    console.error("信眾資料匯入預檢：讀取檔案失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel（.xlsx/.xls）或 CSV 檔" }, { status: 400 });
  }

  // V29 校正模式：以「姓名」為配對主鍵，**完全不依賴家戶編號**。解析前只驗證能否辨識「姓名」欄；
  // 不再要求家戶編號／戶號欄（家戶資料僅供畫面參考，非必要）。不得靜默回傳全 0。
  if (correctionOnly) {
    const withName = correctionPersonRows.filter((r) => String(r["姓名"] ?? "").trim() !== "").length;
    const detected = correctionDetectedColumns.join("、") || "（未偵測到欄名）";
    if (correctionPersonRows.length === 0 || withName === 0) {
      return NextResponse.json(
        { error: `校正模式無法辨識「姓名／信眾姓名」欄，請確認信眾 Excel 的標題列。實際偵測到的欄名：${detected}` },
        { status: 400 }
      );
    }
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
  /**
   * V24 根因修正：正式家戶七欄為固定格式，其標題列一律對應到固定目標 key，不受
   * 「舊的欄位對應記憶（remembered）」或先前誤選影響。先前 bug＝某次測試把
   * 「家戶成員／歷代祖先／乙位正魂」存成錯誤記憶後，正式檔沿用錯誤記憶，成員／牌位
   * 對應不到 householdMembers／ancestors／spirits，預覽全部顯示 0 並被擋。
   * 使用者**這次**手動改過的欄（manualMapping 有值）仍尊重其選擇，不覆蓋。
   */
  const mapping = applyCanonicalDevoteeHouseholdMapping(columns, { ...suggested, ...manualMapping }, manualMapping);

  /**
   * V24 牌位遺失根因修正：正式家戶檔為「合併儲存格、一戶多列」，每一列以「牌位類型」
   * 分類（在世成員／歷代祖先／個人往生者(乙位正魂)），牌位名稱在「牌位顯示名稱」。
   * 先前分組只串接姓名 → 牌位（歷代祖先／乙位正魂）從未被路由 → 預覽全為 0。
   *
   * 這裡標註每列的合成路由欄，並在有「牌位類型」時，讓成員／祖先／乙位正魂一律
   * 由這三個合成欄提供（覆蓋其他來源欄對這三個目標的對應，避免雙重來源衝突）。
   */
  const tabletRouted = annotateTabletRoutedColumns(rows);
  if (tabletRouted) {
    for (const col of Object.keys(mapping)) {
      const t = mapping[col];
      if (t === "householdMembers" || t === "ancestors" || t === "spirits" || t === "allMembers") {
        mapping[col] = null;
      }
    }
    mapping[TABLET_ROUTED_COLUMNS.members] = "householdMembers";
    mapping[TABLET_ROUTED_COLUMNS.ancestors] = "ancestors";
    mapping[TABLET_ROUTED_COLUMNS.spirits] = "spirits";
    // 牌位隨附資料（陽上姓名／安奉地）：逐筆串接後由 decodeTabletMeta() 還原寫入 WorshipRecord。
    mapping[TABLET_ROUTED_COLUMNS.meta] = "tabletMeta";
  }

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

  // V29：校正模式改用「自動偵測標題＋別名正規化」後的信眾列（correctionPersonRows）；略過家戶分析。
  const { batchId, summary, rows: analyzedRows, sheetPreparation, correctionDebug } = await analyzeDevoteeImport(
    fileName,
    correctionOnly ? [] : rows,
    mapping,
    correctionOnly ? correctionPersonRows : personRows,
    correctionOnly
  );

  return NextResponse.json({
    batchId,
    fileName,
    personFileName,
    personRowCount: personRows?.length ?? 0,
    // V12.8：合併儲存格前處理結果
    sheetPreparation,
    // V29 追查用：校正模式各層筆數＋實際欄名（供定位 0 的來源）。
    correctionDebug,
    columns,
    mapping,
    targetFields: getTargetFields(DEVOTEE_IMPORT_KIND),
    summary,
    rows: analyzedRows,
  });
}
