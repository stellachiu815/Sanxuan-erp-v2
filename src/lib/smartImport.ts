import { Buffer } from "node:buffer";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { registerPurificationEntrant } from "@/lib/purification";
import { addGenericParticipant } from "@/lib/templeEvents";
import {
  suggestColumnMappingPure,
  getTargetFields,
  type ImportKind,
  type TargetFieldDef,
} from "@/lib/importFieldSuggestion";

export type { ImportKind, TargetFieldDef };
export { getTargetFields };

/**
 * V8.1「Excel智慧匯入」核心邏輯（需求「三、八」）。
 *
 * 這裡處理的是活動精靈 Step3③「Excel／CSV匯入」共用的部分：
 * 1. 讀檔（xlsx/xls/csv，全部靠既有的 xlsx 套件，家戶批次匯入本來就在用）；
 * 2. 欄位對應記憶（ImportFieldMapping）：Excel 欄位名稱不用照固定順序，
 *    系統會先看這個 importKind 之前有沒有設定過同樣欄位名稱的對應，有的話
 *    自動帶出；找不到記憶時，用一套簡單的別名表做「智慧辨識」（實際規則見
 *    src/lib/importFieldSuggestion.ts，那支是不碰資料庫的純函式，可以在
 *    沙盒裡直接跑自動測試）；都對不到才需要人工手動選擇——一旦手動選過
 *    一次，就會存成記憶，之後同樣的欄位名稱不用再選一次。
 * 3. 分析新增/更新/重複/缺少資料/需要人工確認（不寫入任何資料，純預覽）。
 *
 * 匯入後真正寫入資料庫（確認匯入）依 importKind 呼叫不同的目標函式：
 * 目前支援 "PURIFICATION"（呼叫 src/lib/purification.ts 的
 * registerPurificationEntrant）與通用活動類型（呼叫 src/lib/templeEvents.ts
 * 的 addGenericParticipant）。家戶資料匯入沿用既有的
 * src/app/api/import/preview 那一套，不受這次影響。
 */

/** 讀取已儲存的欄位對應記憶：{ 來源欄位名稱 → ERP 欄位 key }。 */
export async function getFieldMapping(importKind: ImportKind): Promise<Record<string, string>> {
  const rows = await prisma.importFieldMapping.findMany({ where: { importKind } });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.sourceColumnName] = r.targetField;
  return map;
}

/** 儲存一筆欄位對應（使用者手動選過一次之後呼叫，之後同樣欄位名稱會自動記得）。 */
export async function saveFieldMapping(importKind: ImportKind, sourceColumnName: string, targetField: string) {
  await prisma.importFieldMapping.upsert({
    where: { importKind_sourceColumnName: { importKind, sourceColumnName } },
    update: { targetField },
    create: { importKind, sourceColumnName, targetField },
  });
}

/** 依「已儲存記憶 → 別名表」的順序，幫每一個來源欄位猜一個 ERP 欄位（猜不到就是 null，需要人工選擇）。 */
export async function suggestColumnMapping(
  importKind: ImportKind,
  sourceColumns: string[]
): Promise<Record<string, string | null>> {
  const remembered = await getFieldMapping(importKind);
  return suggestColumnMappingPure(importKind, sourceColumns, remembered);
}

/** 把 Excel/CSV 檔案 buffer 解析成「標題列 + 資料列」的通用格式。 */
export function parseSpreadsheetBuffer(buffer: Buffer): { columns: string[]; rows: Record<string, unknown>[] } {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return { columns: [], rows: [] };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];
  return { columns, rows };
}

export type AnalyzedRow = {
  rowNumber: number;
  mapped: Record<string, unknown>;
  status: "NEW" | "UPDATE" | "DUPLICATE" | "MISSING_DATA" | "NEEDS_CONFIRMATION";
  issues: string[];
};

export type ImportAnalysis = {
  columns: string[];
  mapping: Record<string, string | null>;
  rows: AnalyzedRow[];
  summary: { total: number; new: number; update: number; duplicate: number; missingData: number; needsConfirmation: number };
};

/** 把原始列依欄位對應轉成 { targetFieldKey: value }。 */
function applyMapping(row: Record<string, unknown>, mapping: Record<string, string | null>): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [col, value] of Object.entries(row)) {
    // mapping 的 key 一律是「原始」欄位名稱（見 suggestColumnMappingPure 的說明），
    // 這裡直接用 col 查，不再重新去除空白，保持跟前端顯示/使用者調整的欄位對應
    // 完全一致的 key。
    const target = mapping[col];
    if (target) mapped[target] = value;
  }
  return mapped;
}

/**
 * 分析一批匯入資料（需求「三」：先分析新增/更新/重複/缺少資料/待確認，
 * 確認後才正式建立）。純查詢，不寫入任何正式資料，只會建立 ImportBatch/
 * ImportRow 的「預覽」紀錄，供之後「確認匯入」直接使用。
 */
export async function analyzeImport(
  importKind: ImportKind,
  templeEventId: string,
  columns: string[],
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): Promise<ImportAnalysis> {
  const fields = getTargetFields(importKind);
  const requiredKeys = fields.filter((f) => f.required).map((f) => f.key);

  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });

  const analyzedRows: AnalyzedRow[] = [];
  let newCount = 0;
  let updateCount = 0;
  let duplicateCount = 0;
  let missingCount = 0;
  let needsConfirmCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 第 1 列是標題列
    const mapped = applyMapping(rows[i], mapping);
    const issues: string[] = [];

    for (const key of requiredKeys) {
      const value = mapped[key];
      if (value === undefined || value === null || String(value).trim() === "") {
        issues.push(`缺少必填欄位「${fields.find((f) => f.key === key)?.label ?? key}」`);
      }
    }

    let status: AnalyzedRow["status"] = "NEW";

    if (issues.length > 0) {
      status = "MISSING_DATA";
      missingCount++;
      analyzedRows.push({ rowNumber, mapped, status, issues });
      continue;
    }

    const householdId = String(mapped.householdId ?? "").trim();
    const household = householdId
      ? await prisma.household.findFirst({ where: { id: householdId, deletedAt: null } })
      : null;

    if (householdId && !household) {
      issues.push(`找不到家戶編號「${householdId}」，請先在家戶管理建立這一戶，或確認編號是否打錯`);
      status = "NEEDS_CONFIRMATION";
      needsConfirmCount++;
      analyzedRows.push({ rowNumber, mapped, status, issues });
      continue;
    }

    if (importKind === "PURIFICATION" && event) {
      const displayName = String(mapped.displayName ?? "").trim();
      const existingMember = household
        ? await prisma.member.findFirst({ where: { householdId: household.id, name: displayName, deletedAt: null } })
        : null;
      if (existingMember) {
        const existingEntry = await prisma.purificationEntry.findFirst({
          where: { templeEventId, memberId: existingMember.id, deletedAt: null },
        });
        if (existingEntry) {
          status = "DUPLICATE";
          issues.push("這位信眾今年已經報名過祭改了");
          duplicateCount++;
        } else {
          status = "NEW";
          newCount++;
        }
      } else {
        // 信眾主資料裡找不到同名的人：視為臨時報名者，仍然可以匯入（見
        // src/lib/purification.ts 的 isTemporaryName 設計），只是先提醒一下。
        status = "NEEDS_CONFIRMATION";
        issues.push("信眾主資料裡找不到這個姓名，匯入後會建立成「臨時報名者」，建議之後補齊信眾主資料");
        needsConfirmCount++;
      }
    } else if (importKind === "GENERIC_ACTIVITY" && event && household) {
      const existingRecord = await prisma.ritualRecord.findUnique({
        where: {
          householdId_year_activityType: { householdId: household.id, year: event.year, activityType: event.activityType },
        },
      });
      if (existingRecord && existingRecord.status !== "CANCELLED" && !existingRecord.deletedAt) {
        status = "DUPLICATE";
        issues.push("這一戶今年已經參加過這個活動了");
        duplicateCount++;
      } else if (existingRecord) {
        status = "UPDATE";
        updateCount++;
      } else {
        status = "NEW";
        newCount++;
      }
    } else {
      newCount++;
    }

    analyzedRows.push({ rowNumber, mapped, status, issues });
  }

  return {
    columns,
    mapping,
    rows: analyzedRows,
    summary: {
      total: rows.length,
      new: newCount,
      update: updateCount,
      duplicate: duplicateCount,
      missingData: missingCount,
      needsConfirmation: needsConfirmCount,
    },
  };
}

/** 把 Excel 讀出來的國曆生日欄位（可能是 Date 物件、也可能是字串）轉成 Date。 */
export function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value.trim());
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

/** 農曆生日欄位常見輸入格式："1958-02-12" 或 "1958-02-12(閏)"。 */
export function coerceLunarDate(
  value: unknown
): { year: number; month: number; day: number; isLeapMonth: boolean } | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const isLeapMonth = value.includes("閏");
  const cleaned = value.replace(/[()（）]/g, "").replace("閏", "").trim();
  const match = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), isLeapMonth };
}

// ============================================================
// 確認匯入：把分析結果實際寫入資料庫
// ============================================================

export type ImportDecision = "IMPORT" | "SKIP";

export type CommitImportResult = {
  importedCount: number;
  skippedCount: number;
  errors: { rowNumber: number; error: string }[];
};

/**
 * 確認匯入（需求「三」：分析完成、使用者確認後才正式建立）。預設行為：
 * NEW／UPDATE／NEEDS_CONFIRMATION 都會匯入，DUPLICATE／MISSING_DATA 一律
 * 略過——呼叫端（API route）可以用 decisions 覆蓋單一列的預設行為（例如
 * 使用者在畫面上把某一列的「待確認」改成略過，或反過來要強制略過某一筆
 * 重複資料）。
 */
export async function commitImport(
  importKind: ImportKind,
  templeEventId: string,
  rows: AnalyzedRow[],
  decisions: Record<number, ImportDecision>,
  operatorName?: string | null
): Promise<CommitImportResult> {
  let importedCount = 0;
  let skippedCount = 0;
  const errors: { rowNumber: number; error: string }[] = [];

  for (const row of rows) {
    const decision = decisions[row.rowNumber] ?? (row.status === "DUPLICATE" || row.status === "MISSING_DATA" ? "SKIP" : "IMPORT");
    if (decision === "SKIP") {
      skippedCount++;
      continue;
    }

    if (importKind === "PURIFICATION") {
      const householdId = String(row.mapped.householdId ?? "").trim();
      const displayName = String(row.mapped.displayName ?? "").trim();
      const household = await prisma.household.findFirst({ where: { id: householdId, deletedAt: null } });
      const existingMember = household
        ? await prisma.member.findFirst({ where: { householdId: household.id, name: displayName, deletedAt: null } })
        : null;

      const lunar = coerceLunarDate(row.mapped.lunarBirthDate);
      const result = await registerPurificationEntrant(
        templeEventId,
        {
          memberId: existingMember?.id ?? null,
          householdId: householdId || null,
          isTemporaryName: !existingMember,
          manualDisplayName: !existingMember ? displayName : null,
          manualGender: !existingMember ? String(row.mapped.gender ?? "") || null : null,
          manualSolarBirthDate: !existingMember ? coerceDate(row.mapped.solarBirthDate) : null,
          manualLunarBirthYear: !existingMember ? lunar?.year ?? null : null,
          manualLunarBirthMonth: !existingMember ? lunar?.month ?? null : null,
          manualLunarBirthDay: !existingMember ? lunar?.day ?? null : null,
          manualLunarIsLeapMonth: !existingMember ? Boolean(lunar?.isLeapMonth) : false,
          manualAddress: !existingMember ? String(row.mapped.address ?? "") || null : null,
          manualPhone: !existingMember ? String(row.mapped.phone ?? "") || null : null,
          paymentAmount: row.mapped.paymentAmount ? Number(row.mapped.paymentAmount) : null,
          notes: String(row.mapped.notes ?? "") || null,
        },
        operatorName
      );
      if (!result.ok) {
        errors.push({ rowNumber: row.rowNumber, error: result.error });
        continue;
      }
      importedCount++;
    } else {
      const householdId = String(row.mapped.householdId ?? "").trim();
      const amountText = row.mapped.amount ? `金額：${row.mapped.amount}` : "";
      const notes = [String(row.mapped.notes ?? ""), amountText].filter(Boolean).join("；") || null;
      const result = await addGenericParticipant(templeEventId, householdId, notes, operatorName);
      if (!result.ok) {
        errors.push({ rowNumber: row.rowNumber, error: result.error });
        continue;
      }
      importedCount++;
    }
  }

  return { importedCount, skippedCount, errors };
}
