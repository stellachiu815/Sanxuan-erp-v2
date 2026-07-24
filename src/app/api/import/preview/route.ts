/**
 * Excel 批次匯入 — 第一步：上傳並「只驗證、不寫入」正式資料。
 *
 * 流程：
 * 1. 讀取上傳的 Excel（第一個工作表），第一列必須是標題列，欄位名稱要跟
 *    IMPORT_COLUMNS 一致（順序不拘，但文字要完全相符）。
 * 2. 每一列做欄位格式驗證（parseImportRow），再依「家戶編號」分組，
 *    檢查同一家戶在檔案內的欄位是否一致（checkHouseholdConsistency）。
 * 3. 家戶編號如果已經存在資料庫，這個家戶底下所有列一律標記成
 *    DUPLICATE_PENDING（不覆蓋、待確認），即使欄位驗證都通過也一樣。
 * 4. 把整批結果存成一筆 ImportBatch + 多筆 ImportRow（狀態 PREVIEWED 批次），
 *    回傳 batchId 與統計數字、每一列的狀態，讓前端顯示錯誤清單。
 *    這一步「完全不會」寫入 Household / Member / WorshipRecord。
 *
 * V11.3 補上原本沒有的權限管控（見 manageDataImport 說明）：multipart
 * form-data 必須帶 operatorUserId，一樣經過 assertSystemPermissionForOperator 驗證。
 */
import { NextResponse } from "next/server";
import { Buffer } from "node:buffer";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import {
  IMPORT_COLUMNS,
  checkHouseholdConsistency,
  parseImportRow,
  rawRowToPlainRecord,
  type ParsedRow,
} from "@/lib/importRules";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

export async function POST(request: Request) {
  const formData = await request.formData();

  const check = await assertSystemPermissionForOperator(
    await readOperatorUserId(request),
    "manageDataImport"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const file = formData.get("file");

  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "請選擇要上傳的 Excel 檔案" }, { status: 400 });
  }

  let rows: Record<string, unknown>[];
  let fileName = "excel";
  try {
    fileName = (file as File).name || fileName;
    const buffer = Buffer.from(await (file as File).arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      return NextResponse.json({ error: "Excel 檔案裡沒有工作表" }, { status: 400 });
    }
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
  } catch (err) {
    console.error("匯入：讀取 Excel 失敗", err);
    return NextResponse.json({ error: "無法讀取這個檔案，請確認是有效的 Excel（.xlsx）檔" }, { status: 400 });
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Excel 裡沒有資料列（標題列下面沒有內容）" }, { status: 400 });
  }

  // 檢查標題列欄位是否跟需求一致，避免欄位對錯位卻沒發現
  const actualColumns = new Set(Object.keys(rows[0]));
  const missingColumns = IMPORT_COLUMNS.filter((c) => !actualColumns.has(c));
  if (missingColumns.length > 0) {
    return NextResponse.json(
      {
        error: `Excel 標題列缺少欄位：${missingColumns.join("、")}。請使用範本檔案的欄位名稱（順序不拘，但文字要完全一致）`,
      },
      { status: 400 }
    );
  }

  const parsedRows: ParsedRow[] = rows.map((r, i) => parseImportRow(r, i + 2));

  const rowsByHousehold = new Map<string, ParsedRow[]>();
  for (const row of parsedRows) {
    const key = row.householdId || `__missing_row_${row.rowNumber}`;
    if (!rowsByHousehold.has(key)) rowsByHousehold.set(key, []);
    rowsByHousehold.get(key)!.push(row);
  }

  const consistencyErrors = checkHouseholdConsistency(rowsByHousehold);
  for (const [householdId, errs] of consistencyErrors) {
    for (const row of rowsByHousehold.get(householdId) ?? []) {
      row.errors.push(...errs);
    }
  }

  // 查詢哪些家戶編號已經存在資料庫（排除掉那些家戶編號本身是空的分組）
  const candidateIds = Array.from(rowsByHousehold.keys()).filter(
    (k) => !k.startsWith("__missing_row_")
  );
  const existingHouseholds = candidateIds.length
    ? await prisma.household.findMany({
        where: { id: { in: candidateIds } },
        select: { id: true, name: true, contactName: true, phone: true, address: true },
      })
    : [];
  const existingById = new Map(existingHouseholds.map((h) => [h.id, h]));

  let okCount = 0;
  let errorCount = 0;
  let duplicateCount = 0;

  const rowRecords = parsedRows.map((row) => {
    const existing = existingById.get(row.householdId);
    let status: "OK" | "ERROR" | "DUPLICATE_PENDING";
    if (row.errors.length > 0) {
      status = "ERROR";
      errorCount++;
    } else if (existing) {
      status = "DUPLICATE_PENDING";
      duplicateCount++;
    } else {
      status = "OK";
      okCount++;
    }
    return {
      rowNumber: row.rowNumber,
      householdId: row.householdId,
      memberName: row.member?.name ?? null,
      rawData: rawRowToPlainRecord(row.raw),
      status,
      errors: row.errors,
      warnings: row.warnings,
      existingHousehold: existing
        ? { name: existing.name, contactName: existing.contactName, phone: existing.phone, address: existing.address }
        : null,
    };
  });

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      status: "PREVIEWED",
      totalRows: rowRecords.length,
      okCount,
      errorCount,
      duplicateCount,
      rows: {
        create: rowRecords.map((r) => ({
          rowNumber: r.rowNumber,
          householdId: r.householdId,
          memberName: r.memberName,
          rawData: r.rawData,
          status: r.status,
          errors: r.errors,
          warnings: r.warnings,
        })),
      },
    },
  });

  return NextResponse.json({
    batchId: batch.id,
    fileName,
    summary: { total: rowRecords.length, ok: okCount, error: errorCount, duplicatePending: duplicateCount },
    rows: rowRecords,
  });
}
