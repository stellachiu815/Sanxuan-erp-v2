import { Prisma, type ImportRowStatus, type ImportRowResolutionDecision } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  normalizeAndValidateDevoteeRow,
  type NormalizedDevoteeRow,
  type NormalizedHouseholdFields,
  type NormalizedMemberFields,
} from "@/lib/devoteeImportValidate";
import { resolveHouseholdGroups, type RowHouseholdSignals, type HouseholdGroupResolution } from "@/lib/devoteeImportHouseholdGrouping";
import { findDuplicateCandidates, type DuplicateCandidate } from "@/lib/devoteeImportDuplicateCheck";

/**
 * V11.3「信眾資料匯入預檢中心」——批次分析／查詢／人工決定／確認匯入
 * （需求「第五步」～「第十一步」）。這裡是整個模組的「orchestration」層，
 * 本身不重新實作驗證/比對邏輯，全部委派給 devoteeImportValidate.ts／
 * devoteeImportHouseholdGrouping.ts／devoteeImportDuplicateCheck.ts。
 *
 * importKind 固定用 "DEVOTEE_PRECHECK"，跟既有「家戶資料 Excel 批次匯入」
 * （importKind 預設值 "HOUSEHOLD"）共用同一組 ImportBatch／ImportRow 資料表
 * （這兩張表本來就是為了支援多種匯入類型設計的，見 schema.prisma 既有註解），
 * 不建立第二套匯入紀錄資料表。
 */

export const DEVOTEE_IMPORT_KIND = "DEVOTEE_PRECHECK";

export const MAX_TEST_IMPORT_MEMBERS = 30;
export const MAX_TEST_IMPORT_HOUSEHOLDS = 10;

/** 上傳檔案大小上限（需求「第二步」：檔案大小需有限制）。這個模組本來就限定
 *  「小規模測試匯入」（單批最多 30 人或 10 戶），10MB 對單一 Excel/CSV 檔案
 *  來說已經非常寬裕，超過大概率是選錯檔案。 */
export const MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024;

/** 允許上傳的副檔名（需求「第二步」：支援 .xlsx/.xls/.csv，需明確的格式錯誤訊息）。 */
export const ALLOWED_UPLOAD_EXTENSIONS = [".xlsx", ".xls", ".csv"];

export function hasAllowedUploadExtension(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return ALLOWED_UPLOAD_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

// ============================================================
// 一、原始資料 ↔ 可存進 Json 欄位的安全格式互轉
// ============================================================

function toJsonSafeValue(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v === undefined) return null;
  return v;
}

function toJsonSafeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) out[k] = toJsonSafeValue(v);
  return out;
}

type StoredRowPayload = {
  raw: Record<string, unknown>;
  normalized: {
    household: NormalizedHouseholdFields;
    member: Omit<NormalizedMemberFields, "solarBirthDate"> & { solarBirthDate: string | null };
  };
};

/**
 * 需求確認④：候選比對結果不落地保存，每次重新即時查詢；但要重新查詢就需要
 * 「這一列正規化後的家戶／信眾欄位」，所以這裡把正規化結果（不是候選比對
 * 結果本身）存進既有的 rawData Json 欄位——不新增 Prisma 欄位，沿用既有
 * 欄位、只是這個匯入類型存的 JSON 形狀是「原始列 ＋ 正規化後結果」，跟舊的
 * 家戶批次匯入（只存原始列）分開解讀，兩者透過 ImportBatch.importKind 區分。
 */
function serializeRowForStorage(row: NormalizedDevoteeRow): StoredRowPayload {
  return {
    raw: toJsonSafeRow(row.raw),
    normalized: {
      household: row.household,
      member: {
        ...row.member,
        solarBirthDate: row.member.solarBirthDate ? row.member.solarBirthDate.toISOString().slice(0, 10) : null,
      },
    },
  };
}

function deserializeStoredRow(rowNumber: number, stored: StoredRowPayload): NormalizedDevoteeRow {
  const member: NormalizedMemberFields = {
    ...stored.normalized.member,
    solarBirthDate: stored.normalized.member.solarBirthDate
      ? new Date(`${stored.normalized.member.solarBirthDate}T00:00:00.000Z`)
      : null,
  };
  return {
    rowNumber,
    raw: stored.raw,
    household: stored.normalized.household,
    member,
    missingFieldErrors: [],
    formatErrors: [],
    warnings: [],
  };
}

// ============================================================
// 二、單列狀態判斷（結合：驗證結果／家戶分組／疑似重複／人工決定）
// ============================================================

export type RowResolution = {
  decision: ImportRowResolutionDecision;
  householdId: string | null;
};

export type RowComputedState = {
  status: ImportRowStatus;
  effectiveHouseholdId: string | null;
  candidates: DuplicateCandidate[];
  groupReason: string | null;
};

function computeRowState(
  normalized: NormalizedDevoteeRow,
  grouping: HouseholdGroupResolution,
  candidates: DuplicateCandidate[],
  resolution: RowResolution | null
): RowComputedState {
  // 資料本身的問題永遠優先，人工不能「確認」一筆連姓名都沒填、或格式看不懂的資料。
  if (normalized.missingFieldErrors.length > 0) {
    return { status: "INCOMPLETE_DATA", effectiveHouseholdId: null, candidates: [], groupReason: null };
  }
  if (normalized.formatErrors.length > 0) {
    return { status: "FORMAT_ERROR", effectiveHouseholdId: null, candidates: [], groupReason: null };
  }

  // 人工已經做出的決定優先於自動判斷（需求確認④：不用每次重新判斷一次）。
  if (resolution) {
    if (resolution.decision === "SKIP") {
      return { status: "EXCLUDED", effectiveHouseholdId: null, candidates, groupReason: grouping.reason };
    }
    if (resolution.decision === "CONFIRMED_DUPLICATE") {
      return { status: "EXCLUDED", effectiveHouseholdId: resolution.householdId, candidates, groupReason: grouping.reason };
    }
    if (resolution.decision === "ASSIGN_HOUSEHOLD" && resolution.householdId) {
      return { status: "READY_TO_IMPORT", effectiveHouseholdId: resolution.householdId, candidates: [], groupReason: null };
    }
    if (resolution.decision === "CONFIRMED_NOT_DUPLICATE") {
      if (!grouping.resolvedCode || grouping.uncertain) {
        return { status: "HOUSEHOLD_UNCERTAIN", effectiveHouseholdId: null, candidates: [], groupReason: grouping.reason };
      }
      return { status: "READY_TO_IMPORT", effectiveHouseholdId: grouping.resolvedCode, candidates: [], groupReason: null };
    }
  }

  // 自動判斷（沒有人工決定，或決定尚未涵蓋目前狀況）。
  if (!grouping.resolvedCode || grouping.uncertain) {
    return { status: "HOUSEHOLD_UNCERTAIN", effectiveHouseholdId: null, candidates, groupReason: grouping.reason };
  }
  if (candidates.length > 0) {
    return { status: "SUSPECTED_DUPLICATE", effectiveHouseholdId: grouping.resolvedCode, candidates, groupReason: null };
  }
  return { status: "READY_TO_IMPORT", effectiveHouseholdId: grouping.resolvedCode, candidates: [], groupReason: null };
}

export type DevoteeImportSummary = {
  total: number;
  readyToImport: number;
  suspectedDuplicate: number;
  incompleteData: number;
  formatError: number;
  householdUncertain: number;
  excluded: number;
};

function buildSummary(statuses: ImportRowStatus[]): DevoteeImportSummary {
  const count = (s: ImportRowStatus) => statuses.filter((x) => x === s).length;
  return {
    total: statuses.length,
    readyToImport: count("READY_TO_IMPORT"),
    suspectedDuplicate: count("SUSPECTED_DUPLICATE"),
    incompleteData: count("INCOMPLETE_DATA"),
    formatError: count("FORMAT_ERROR"),
    householdUncertain: count("HOUSEHOLD_UNCERTAIN"),
    excluded: count("EXCLUDED"),
  };
}

export type AnalyzedDevoteeRow = {
  id: string;
  rowNumber: number;
  household: NormalizedHouseholdFields;
  member: NormalizedMemberFields;
  status: ImportRowStatus;
  effectiveHouseholdId: string | null;
  errors: string[];
  warnings: string[];
  candidates: DuplicateCandidate[];
  groupReason: string | null;
  resolution: { decision: ImportRowResolutionDecision; householdId: string | null; note: string | null } | null;
};

// ============================================================
// 三、第一步：分析（上傳＋欄位對照後，預覽，不寫入正式資料）
// ============================================================

export async function analyzeDevoteeImport(
  fileName: string,
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): Promise<{ batchId: string; summary: DevoteeImportSummary; rows: AnalyzedDevoteeRow[] }> {
  const normalizedRows = rawRows.map((r, i) => normalizeAndValidateDevoteeRow(r, mapping, i + 2));

  const groupingInput: RowHouseholdSignals[] = normalizedRows.map((r) => ({
    rowNumber: r.rowNumber,
    code: r.household.code,
    address: r.household.address,
    contactName: r.household.contactName,
    phone: r.household.phone ?? r.household.mobile,
  }));
  const groupings = resolveHouseholdGroups(groupingInput);
  const groupingByRow = new Map(groupings.map((g) => [g.rowNumber, g]));

  const rowsToCreate: {
    rowNumber: number;
    householdId: string;
    memberName: string | null;
    rawData: Prisma.InputJsonValue;
    status: ImportRowStatus;
    errors: string[];
    warnings: string[];
  }[] = [];
  const states: RowComputedState[] = [];

  for (const normalized of normalizedRows) {
    const grouping = groupingByRow.get(normalized.rowNumber)!;
    const hasBaseErrors = normalized.missingFieldErrors.length > 0 || normalized.formatErrors.length > 0;
    const candidates = hasBaseErrors ? [] : await findDuplicateCandidates(normalized);
    const state = computeRowState(normalized, grouping, candidates, null);
    states.push(state);

    rowsToCreate.push({
      rowNumber: normalized.rowNumber,
      householdId: state.effectiveHouseholdId ?? normalized.household.code ?? "",
      memberName: normalized.member.name || null,
      rawData: serializeRowForStorage(normalized) as unknown as Prisma.InputJsonValue,
      status: state.status,
      errors: [...normalized.missingFieldErrors, ...normalized.formatErrors],
      warnings: normalized.warnings,
    });
  }

  const summary = buildSummary(states.map((s) => s.status));

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      importKind: DEVOTEE_IMPORT_KIND,
      status: "PREVIEWED",
      totalRows: rowsToCreate.length,
      okCount: summary.readyToImport,
      errorCount: summary.formatError + summary.incompleteData,
      duplicateCount: summary.suspectedDuplicate,
      rows: { create: rowsToCreate },
    },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });

  const rows: AnalyzedDevoteeRow[] = batch.rows.map((r, i) => {
    const normalized = normalizedRows[i];
    const state = states[i];
    return {
      id: r.id,
      rowNumber: r.rowNumber,
      household: normalized.household,
      member: normalized.member,
      status: state.status,
      effectiveHouseholdId: state.effectiveHouseholdId,
      errors: [...normalized.missingFieldErrors, ...normalized.formatErrors],
      warnings: normalized.warnings,
      candidates: state.candidates,
      groupReason: state.groupReason,
      resolution: null,
    };
  });

  return { batchId: batch.id, summary, rows };
}

// ============================================================
// 四、第二步：查看批次（尚未確認的批次即時重新比對；已確認的批次凍結顯示）
// ============================================================

export type DevoteeImportBatchView = {
  batchId: string;
  fileName: string;
  status: "PREVIEWED" | "COMMITTED";
  summary: DevoteeImportSummary;
  rows: AnalyzedDevoteeRow[];
  createdAt: Date;
  committedAt: Date | null;
  importedHouseholdIds: string[];
  importedMemberIds: string[];
};

export async function getDevoteeImportBatch(batchId: string): Promise<DevoteeImportBatchView | null> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch || batch.importKind !== DEVOTEE_IMPORT_KIND) return null;

  if (batch.status === "COMMITTED") {
    // 需求確認④：已完成的批次一律凍結顯示當時真正執行的結果，不重新計算。
    const rows: AnalyzedDevoteeRow[] = batch.rows.map((r) => {
      const stored = r.rawData as unknown as StoredRowPayload;
      const normalized = deserializeStoredRow(r.rowNumber, stored);
      return {
        id: r.id,
        rowNumber: r.rowNumber,
        household: normalized.household,
        member: normalized.member,
        status: r.status,
        effectiveHouseholdId: r.status === "IMPORTED" ? r.householdId : null,
        errors: (r.errors as string[] | null) ?? [],
        warnings: (r.warnings as string[] | null) ?? [],
        candidates: [],
        groupReason: null,
        resolution: r.resolutionDecision
          ? { decision: r.resolutionDecision, householdId: r.resolutionHouseholdId, note: r.resolutionNote }
          : null,
      };
    });
    return {
      batchId: batch.id,
      fileName: batch.fileName,
      status: "COMMITTED",
      summary: buildSummary(batch.rows.map((r) => r.status)),
      rows,
      createdAt: batch.createdAt,
      committedAt: batch.committedAt,
      importedHouseholdIds: [],
      importedMemberIds: [],
    };
  }

  // 尚未確認：資料本身有問題（INCOMPLETE_DATA／FORMAT_ERROR）的列不需要重新
  // 查資料庫（跟資料庫狀態無關，結果不會變），其餘列即時重新查詢比對，人工
  // 已經做出的決定（resolutionDecision）優先採用。
  const normalizedRows = batch.rows.map((r) => deserializeStoredRow(r.rowNumber, r.rawData as unknown as StoredRowPayload));
  const groupingInput: RowHouseholdSignals[] = normalizedRows.map((r) => ({
    rowNumber: r.rowNumber,
    code: r.household.code,
    address: r.household.address,
    contactName: r.household.contactName,
    phone: r.household.phone ?? r.household.mobile,
  }));
  const groupings = resolveHouseholdGroups(groupingInput);
  const groupingByRow = new Map(groupings.map((g) => [g.rowNumber, g]));

  const rows: AnalyzedDevoteeRow[] = [];
  const finalStatuses: ImportRowStatus[] = [];

  for (let i = 0; i < batch.rows.length; i++) {
    const r = batch.rows[i];
    const normalized = normalizedRows[i];
    const frozenErrors = (r.errors as string[] | null) ?? [];

    if (r.status === "INCOMPLETE_DATA" || r.status === "FORMAT_ERROR") {
      rows.push({
        id: r.id,
        rowNumber: r.rowNumber,
        household: normalized.household,
        member: normalized.member,
        status: r.status,
        effectiveHouseholdId: null,
        errors: frozenErrors,
        warnings: (r.warnings as string[] | null) ?? [],
        candidates: [],
        groupReason: null,
        resolution: null,
      });
      finalStatuses.push(r.status);
      continue;
    }

    const grouping = groupingByRow.get(r.rowNumber)!;
    const candidates = await findDuplicateCandidates(normalized);
    const resolution: RowResolution | null = r.resolutionDecision
      ? { decision: r.resolutionDecision, householdId: r.resolutionHouseholdId }
      : null;
    const state = computeRowState(normalized, grouping, candidates, resolution);

    rows.push({
      id: r.id,
      rowNumber: r.rowNumber,
      household: normalized.household,
      member: normalized.member,
      status: state.status,
      effectiveHouseholdId: state.effectiveHouseholdId,
      errors: frozenErrors,
      warnings: (r.warnings as string[] | null) ?? [],
      candidates: state.candidates,
      groupReason: state.groupReason,
      resolution: r.resolutionDecision
        ? { decision: r.resolutionDecision, householdId: r.resolutionHouseholdId, note: r.resolutionNote }
        : null,
    });
    finalStatuses.push(state.status);
  }

  return {
    batchId: batch.id,
    fileName: batch.fileName,
    status: "PREVIEWED",
    summary: buildSummary(finalStatuses),
    rows,
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
    importedHouseholdIds: [],
    importedMemberIds: [],
  };
}

// ============================================================
// 五、第三步：人工決定（疑似重複／待確認家戶的最終處理決定，需求確認④）
// ============================================================

export type ResolveRowInput = {
  decision: ImportRowResolutionDecision;
  householdId?: string | null;
  memberId?: string | null;
  note?: string | null;
  operatorName?: string | null;
};

export type ResolveRowResult = { ok: true } | { ok: false; error: string };

export async function resolveDevoteeImportRow(
  batchId: string,
  rowId: string,
  input: ResolveRowInput
): Promise<ResolveRowResult> {
  const batch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.importKind !== DEVOTEE_IMPORT_KIND) return { ok: false, error: "找不到這個匯入批次" };
  if (batch.status === "COMMITTED") return { ok: false, error: "這個批次已經確認匯入過了，無法再修改人工決定" };

  const row = await prisma.importRow.findFirst({ where: { id: rowId, batchId } });
  if (!row) return { ok: false, error: "找不到這一列匯入資料" };
  if (row.status === "INCOMPLETE_DATA" || row.status === "FORMAT_ERROR") {
    return { ok: false, error: "這一列資料本身有問題（資料不完整或格式錯誤），請先修正 Excel 後重新上傳，不能直接標記決定" };
  }

  if (input.decision === "ASSIGN_HOUSEHOLD") {
    if (!input.householdId) return { ok: false, error: "指定歸屬家戶時必須提供家戶編號" };
    const target = await prisma.household.findFirst({ where: { id: input.householdId, deletedAt: null } });
    if (!target) return { ok: false, error: `找不到家戶編號「${input.householdId}」，請確認是否輸入正確` };
  }

  await prisma.importRow.update({
    where: { id: rowId },
    data: {
      resolutionDecision: input.decision,
      resolutionHouseholdId: input.decision === "ASSIGN_HOUSEHOLD" || input.decision === "CONFIRMED_DUPLICATE" ? input.householdId ?? null : null,
      resolutionMemberId: input.decision === "CONFIRMED_DUPLICATE" ? input.memberId ?? null : null,
      resolutionNote: input.note?.trim() || null,
      resolvedAt: new Date(),
      resolvedByName: input.operatorName?.trim() || null,
    },
  });

  return { ok: true };
}

// ============================================================
// 六、第四步：確認匯入（測試匯入上限、Transaction 寫入、結果凍結）
// ============================================================

export type CommitDevoteeImportResult =
  | {
      ok: true;
      householdsCreated: number;
      membersCreated: number;
      skippedCount: number;
      failedCount: number;
      failures: { rowNumber: number; name: string | null; error: string }[];
      committedAt: Date;
    }
  | { ok: false; status: number; error: string };

/** 確認匯入前的預覽數字（需求「第八步」確認視窗：即將新增家戶數／信眾數／略過筆數／疑似重複筆數／錯誤筆數）。 */
export async function getCommitPreview(batchId: string): Promise<
  | {
      ok: true;
      newHouseholdCount: number;
      newMemberCount: number;
      skippedCount: number;
      suspectedDuplicateCount: number;
      errorCount: number;
      overCap: boolean;
      capMessage: string | null;
    }
  | { ok: false; error: string }
> {
  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, error: "找不到這個匯入批次" };
  if (view.status === "COMMITTED") return { ok: false, error: "這個批次已經確認匯入過了" };

  const readyRows = view.rows.filter((r) => r.status === "READY_TO_IMPORT" && r.effectiveHouseholdId);
  const existingHouseholds = await prisma.household.findMany({
    where: { id: { in: Array.from(new Set(readyRows.map((r) => r.effectiveHouseholdId!))) }, deletedAt: null },
    select: { id: true },
  });
  const existingIds = new Set(existingHouseholds.map((h) => h.id));
  const newHouseholdIds = new Set(readyRows.map((r) => r.effectiveHouseholdId!).filter((id) => !existingIds.has(id)));

  const newMemberCount = readyRows.length;
  const newHouseholdCount = newHouseholdIds.size;
  const overCap = newMemberCount > MAX_TEST_IMPORT_MEMBERS || newHouseholdCount > MAX_TEST_IMPORT_HOUSEHOLDS;

  return {
    ok: true,
    newHouseholdCount,
    newMemberCount,
    skippedCount: view.summary.excluded,
    suspectedDuplicateCount: view.summary.suspectedDuplicate,
    errorCount: view.summary.incompleteData + view.summary.formatError,
    overCap,
    capMessage: overCap ? `目前為測試匯入階段，單次最多匯入${MAX_TEST_IMPORT_MEMBERS}人或${MAX_TEST_IMPORT_HOUSEHOLDS}戶，請縮小測試範圍。` : null,
  };
}

export async function commitDevoteeImport(batchId: string, operatorName?: string | null): Promise<CommitDevoteeImportResult> {
  const preview = await getCommitPreview(batchId);
  if (!preview.ok) return { ok: false, status: 404, error: preview.error };
  if (preview.overCap) return { ok: false, status: 400, error: preview.capMessage! };
  if (preview.newMemberCount === 0) return { ok: false, status: 400, error: "這個批次目前沒有「可新增」且已確認的資料可以匯入" };

  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, status: 404, error: "找不到這個匯入批次" };
  const readyRows = view.rows.filter((r) => r.status === "READY_TO_IMPORT" && r.effectiveHouseholdId);

  const rowsByHousehold = new Map<string, AnalyzedDevoteeRow[]>();
  for (const r of readyRows) {
    const key = r.effectiveHouseholdId!;
    if (!rowsByHousehold.has(key)) rowsByHousehold.set(key, []);
    rowsByHousehold.get(key)!.push(r);
  }

  const failures: { rowNumber: number; name: string | null; error: string }[] = [];
  let householdsCreated = 0;
  let membersCreated = 0;
  const importedRowIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // 防止重複送出（按鈕連點或兩個分頁同時按下確認匯入）：用「WHERE status
      // = PREVIEWED 才更新」搶佔這個批次，Postgres 會在這個 UPDATE 敘述內
      // 對這一列上鎖，兩個同時進來的 transaction 會被序列化——先搶到的那個
      // 會把狀態改成 COMMITTED，晚到的那個重新讀到 status 已經不是
      // PREVIEWED，claimed.count 會是 0，直接中止、整批回滾，不會建立
      // 兩次一樣的家戶／信眾資料。
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, status: "PREVIEWED" },
        data: { status: "COMMITTED", committedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error("這個批次已經確認匯入過了（可能是重複送出），請重新整理頁面查看結果，不會重複建立資料");
      }

      for (const [householdId, rows] of rowsByHousehold) {
        // 匯入當下再檢查一次是否已存在，避免預覽跟確認匯入之間有人手動建立
        // 同編號家戶造成的競爭情形（跟既有家戶批次匯入 commit route 同一個防呆精神）。
        let household = await tx.household.findFirst({ where: { id: householdId, deletedAt: null } });
        if (!household) {
          const first = rows[0];
          // 需求「第三步」的欄位清單沒有「家戶名稱」——這是刻意的設計取捨
          // （非逐字規定）：優先用主要聯絡人當家戶顯示名稱，完全沒有聯絡人
          // 資料時退回「{戶號} 號家戶」，確保 Household.name（既有必填欄位）
          // 一定有合理內容，不會因為這次沒有蒐集這個欄位就寫入空字串。
          const householdName = first.household.contactName ? first.household.contactName : `${householdId} 號家戶`;
          household = await tx.household.create({
            data: {
              id: householdId,
              name: householdName,
              contactName: first.household.contactName,
              phone: first.household.phone,
              mobile: first.household.mobile,
              address: first.household.address,
              companyName: first.household.companyName,
              notes: first.household.notes,
            },
          });
          await recordVersion(
            { entityType: "Household", entityId: household.id, action: "CREATE", afterData: household, operatorName, changeNote: "信眾資料匯入預檢中心：測試匯入" },
            tx
          );
          householdsCreated++;
        }

        for (const r of rows) {
          if (!r.member.name) {
            failures.push({ rowNumber: r.rowNumber, name: null, error: "缺少姓名，無法建立信眾" });
            continue;
          }
          const created = await tx.member.create({
            data: {
              householdId: household.id,
              name: r.member.name,
              gender: r.member.gender,
              role: r.member.relationToHead,
              solarBirthDate: r.member.solarBirthDate,
              lunarBirthYear: r.member.lunarBirthYear,
              lunarBirthMonth: r.member.lunarBirthMonth,
              lunarBirthDay: r.member.lunarBirthDay,
              lunarIsLeapMonth: r.member.lunarIsLeapMonth,
              birthHour: r.member.birthHour,
              isDeceased: r.member.isDeceased,
              yangshangName: r.member.yangshangName,
              notes: r.member.notes,
            },
          });
          await recordVersion(
            { entityType: "Member", entityId: created.id, action: "CREATE", afterData: created, operatorName, changeNote: "信眾資料匯入預檢中心：測試匯入" },
            tx
          );
          membersCreated++;
          importedRowIds.push(r.id);
        }
      }

      if (importedRowIds.length > 0) {
        await tx.importRow.updateMany({ where: { id: { in: importedRowIds } }, data: { status: "IMPORTED" } });
      }
      // 確認匯入時仍然不匯入的列（疑似重複／待確認家戶／使用者選擇略過），
      // 一律凍結成 EXCLUDED，符合需求「已完成匯入的批次，結果不會被日後
      // 資料庫內容改變影響」。
      const excludedRowIds = view.rows.filter((r) => !importedRowIds.includes(r.id)).map((r) => r.id);
      if (excludedRowIds.length > 0) {
        await tx.importRow.updateMany({ where: { id: { in: excludedRowIds } }, data: { status: "EXCLUDED" } });
      }

      // 狀態與 committedAt 已經在上面的搶佔步驟寫入，這裡只需要補上實際匯入筆數。
      await tx.importBatch.update({
        where: { id: batchId },
        data: { importedRowCount: importedRowIds.length },
      });
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "確認匯入時發生錯誤";
    return { ok: false, status: 400, error: `匯入失敗，整批交易已回滾，沒有任何資料寫入：${message}` };
  }

  const committedBatch = await prisma.importBatch.findUnique({ where: { id: batchId } });

  return {
    ok: true,
    householdsCreated,
    membersCreated,
    // 「略過」＝這次確認匯入時，沒有被嘗試寫入的列（疑似重複／待確認家戶／
    // 使用者選擇略過／資料本身有問題）；readyRows 裡的每一列最後只會落在
    // 「membersCreated」或「failures」兩者之一（見上面迴圈：沒有姓名才會
    // push failure，否則一定 create 成功並計入 membersCreated），所以
    // 用「總列數－這次嘗試匯入的列數」就是略過筆數，不需要用失敗數反推。
    skippedCount: view.rows.length - readyRows.length,
    failedCount: failures.length,
    failures,
    committedAt: committedBatch?.committedAt ?? new Date(),
  };
}

// ============================================================
// 七、匯入結果：錯誤清單匯出（需求「第十步」）
// ============================================================

export async function buildDevoteeImportErrorCsv(batchId: string): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, error: "找不到這個匯入批次" };

  const problemRows = view.rows.filter((r) => r.status === "INCOMPLETE_DATA" || r.status === "FORMAT_ERROR" || r.status === "HOUSEHOLD_UNCERTAIN");
  const header = ["原始列號", "姓名", "錯誤原因", "原始資料摘要"];
  const lines = [header.join(",")];
  for (const r of problemRows) {
    const reasons = [...r.errors, r.groupReason].filter((v): v is string => !!v).join("；");
    const summary = `戶號:${r.household.code || "（無）"} 地址:${r.household.address ?? "（無）"} 電話:${r.household.phone ?? r.household.mobile ?? "（無）"}`;
    const cells = [String(r.rowNumber), r.member.name || "（無）", reasons, summary].map(csvEscape);
    lines.push(cells.join(","));
  }
  return { ok: true, csv: lines.join("\n") };
}

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes("\n") || v.includes('"')) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}
