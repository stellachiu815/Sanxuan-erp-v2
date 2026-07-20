import { Prisma, type ImportRowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  normalizeAndValidateDevoteeRow,
  type NormalizedDevoteeRow,
  type NormalizedHouseholdFields,
} from "@/lib/devoteeImportValidate";

/**
 * V11.3「信眾資料匯入預檢中心」正式版——批次分析／查詢／確認匯入（依正式
 * 7 欄 Excel 格式：家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先｜乙位正魂｜
 * 家戶成員，一列＝一戶）。這裡是整個模組的「orchestration」層，本身不重新
 * 實作驗證邏輯，委派給 devoteeImportValidate.ts。
 *
 * importKind 固定用 "DEVOTEE_PRECHECK"，跟既有「家戶資料 Excel 批次匯入」
 * （importKind 預設值 "HOUSEHOLD"，見 src/lib/importRules.ts）共用同一組
 * ImportBatch／ImportRow 資料表，不建立第二套匯入紀錄資料表，也完全不影響
 * 舊的家戶批次匯入功能。
 *
 * ⚠️ 這一版是舊版（彈性欄位、姓名必填、疑似重複人工比對、家戶分組線索
 * 判斷）的「完全取代」，不是並存的第二套格式（使用者已明確選擇「完全改成
 * 只支援這七欄」）。因為新格式一列就是一戶、家戶編號是唯一鍵，家戶層級的
 * 「疑似重複／待確認家戶」判斷變成單純的「編號是否已存在」，不再需要
 * devoteeImportDuplicateCheck.ts／devoteeImportHouseholdGrouping.ts 那套
 * 模糊比對與人工決定機制（resolutionDecision 相關的 API／UI 也一併移除），
 * 這兩個檔案已刪除。
 *
 * 匯入規則（需求逐字對應）：
 *   一、Household：家戶編號已存在＝更新戶名／主要聯絡人／地址；不存在＝新增。
 *   二、家戶成員：拆解成多筆 Member，全部掛在同一個 Household。
 *   三、歷代祖先：拆解成多筆 WorshipRecord（type = ANCESTOR_LINE）。
 *   四、乙位正魂：拆解成多筆 WorshipRecord（type = INDIVIDUAL）。
 *   建立順序：Household → Member → Ancestor → Spirit。
 *   重複匯入：家戶成員／歷代祖先／乙位正魂一律依「姓名／稱謂文字是否已存在
 *   於同一戶」比對，已存在的略過、不新增、不覆蓋、不刪除，只新增找不到的。
 */

export const DEVOTEE_IMPORT_KIND = "DEVOTEE_PRECHECK";

export const MAX_TEST_IMPORT_MEMBERS = 30;
export const MAX_TEST_IMPORT_HOUSEHOLDS = 10;

/** 上傳檔案大小上限（需求「第二步」：檔案大小需有限制）。 */
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
    memberNames: string[];
    ancestorNames: string[];
    spiritNames: string[];
  };
};

/**
 * 正式格式的家戶／成員／祖先／乙位正魂欄位全部都是文字，沒有日期等需要
 * 特殊序列化的型別，所以跟舊版比起來，這裡的存取格式單純很多——直接把
 * 正規化結果存進既有的 rawData Json 欄位（沿用既有欄位，不新增 Prisma
 * 欄位）。
 */
function serializeRowForStorage(row: NormalizedDevoteeRow): StoredRowPayload {
  return {
    raw: toJsonSafeRow(row.raw),
    normalized: {
      household: row.household,
      memberNames: row.memberNames,
      ancestorNames: row.ancestorNames,
      spiritNames: row.spiritNames,
    },
  };
}

function deserializeStoredRow(rowNumber: number, stored: StoredRowPayload): NormalizedDevoteeRow {
  return {
    rowNumber,
    raw: stored.raw,
    household: stored.normalized.household,
    memberNames: stored.normalized.memberNames,
    ancestorNames: stored.normalized.ancestorNames,
    spiritNames: stored.normalized.spiritNames,
    missingFieldErrors: [],
    formatErrors: [],
    warnings: [],
  };
}

// ============================================================
// 二、單列狀態判斷
// ============================================================
//
// ⚠️ 跟舊版最大的不同：正式格式的家戶／成員／祖先／乙位正魂是否已存在，
// 只會影響「確認匯入時要新增還是略過／更新」，不會影響預覽階段要顯示
// 什麼狀態——一列本身的資料乾不乾淨（有沒有填家戶編號／戶名／家戶成員）
// 才決定這一列能不能匯入，所以這裡不需要像舊版一樣即時查資料庫，狀態在
// 分析當下就能一次算完，之後不會變。

function computeRowStatus(normalized: NormalizedDevoteeRow): ImportRowStatus {
  if (normalized.missingFieldErrors.length > 0) return "INCOMPLETE_DATA";
  if (normalized.formatErrors.length > 0) return "FORMAT_ERROR";
  return "READY_TO_IMPORT";
}

export type DevoteeImportSummary = {
  total: number;
  readyToImport: number;
  incompleteData: number;
  formatError: number;
  excluded: number;
  imported: number;
};

function buildSummary(statuses: ImportRowStatus[]): DevoteeImportSummary {
  const count = (s: ImportRowStatus) => statuses.filter((x) => x === s).length;
  return {
    total: statuses.length,
    readyToImport: count("READY_TO_IMPORT"),
    incompleteData: count("INCOMPLETE_DATA"),
    formatError: count("FORMAT_ERROR"),
    excluded: count("EXCLUDED"),
    imported: count("IMPORTED"),
  };
}

export type AnalyzedDevoteeRow = {
  id: string;
  rowNumber: number;
  household: NormalizedHouseholdFields;
  memberNames: string[];
  ancestorNames: string[];
  spiritNames: string[];
  status: ImportRowStatus;
  errors: string[];
  warnings: string[];
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

  /**
   * V12.3 指令七.5：預檢階段就要標示家戶編號的狀況，不能等到正式匯入才爆炸。
   *
   * 對每一列的家戶編號先做一次解析：
   *   - 命中別名（改過編號／已被合併）→ 加一則提醒，告知會更新到哪一戶
   *   - 命中已封存、且沒有合併也沒有別名的家戶 → 標示為衝突（錯誤），
   *     要求人工決定恢復／改編號／略過，避免正式匯入時撞主鍵 P2002
   *
   * 這裡只做查詢，不寫入任何資料；正式 Excel 七欄格式完全沒有改變。
   */
  const codes = Array.from(new Set(normalizedRows.map((n) => n.household.code).filter(Boolean)));
  const [existingHouseholds, aliases] = await Promise.all([
    codes.length > 0
      ? prisma.household.findMany({
          where: { id: { in: codes } },
          select: { id: true, name: true, deletedAt: true, mergedIntoHouseholdId: true },
        })
      : Promise.resolve([]),
    codes.length > 0
      ? prisma.householdCodeAlias.findMany({
          where: { oldCode: { in: codes } },
          include: { household: { select: { id: true, name: true, deletedAt: true } } },
        })
      : Promise.resolve([]),
  ]);
  const existingByCode = new Map(existingHouseholds.map((h) => [h.id, h]));
  const aliasByCode = new Map(aliases.map((a) => [a.oldCode, a]));

  /** 回傳這個家戶編號在預檢階段的額外錯誤與提醒。 */
  function inspectHouseholdCode(code: string): { errors: string[]; warnings: string[] } {
    if (!code) return { errors: [], warnings: [] };

    const direct = existingByCode.get(code);
    if (direct && !direct.deletedAt) return { errors: [], warnings: [] }; // 正常更新既有家戶

    const alias = aliasByCode.get(code);
    if (alias?.household && !alias.household.deletedAt) {
      return {
        errors: [],
        warnings: [
          `家戶編號 ${code} 是舊編號，將自動對照到目前的家戶 ${alias.household.id}（${alias.household.name}）並更新其資料，不會新增第二戶。`,
        ],
      };
    }

    if (direct?.deletedAt) {
      return {
        errors: [
          `家戶編號 ${code} 屬於已封存的家戶「${direct.name}」，既沒有合併也沒有編號對照。請先從回收區恢復、或改用其他編號、或把這一列排除後再匯入。`,
        ],
        warnings: [],
      };
    }

    return { errors: [], warnings: [] }; // 全新編號，正常新增
  }

  const rowsToCreate = normalizedRows.map((normalized) => {
    const codeCheck = inspectHouseholdCode(normalized.household.code || "");
    // 家戶編號衝突視為這一列的格式錯誤，不會進入 READY_TO_IMPORT。
    const status = codeCheck.errors.length > 0 ? ("FORMAT_ERROR" as const) : computeRowStatus(normalized);
    return {
      rowNumber: normalized.rowNumber,
      householdId: normalized.household.code || "",
      // 既有欄位（ImportRow.memberName）沿用來存「這一列的顯示用名稱」，
      // 正式格式一列＝一戶，所以存戶名（不是信眾姓名），供錯誤清單顯示用。
      memberName: normalized.household.name || null,
      rawData: serializeRowForStorage(normalized) as unknown as Prisma.InputJsonValue,
      status,
      errors: [...normalized.missingFieldErrors, ...normalized.formatErrors, ...codeCheck.errors],
      warnings: [...normalized.warnings, ...codeCheck.warnings],
    };
  });

  const summary = buildSummary(rowsToCreate.map((r) => r.status));

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      importKind: DEVOTEE_IMPORT_KIND,
      status: "PREVIEWED",
      totalRows: rowsToCreate.length,
      okCount: summary.readyToImport,
      errorCount: summary.formatError + summary.incompleteData,
      duplicateCount: 0, // 正式格式沒有「疑似重複」這個概念，固定為 0
      rows: { create: rowsToCreate },
    },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });

  const rows: AnalyzedDevoteeRow[] = batch.rows.map((r, i) => {
    const normalized = normalizedRows[i];
    return {
      id: r.id,
      rowNumber: r.rowNumber,
      household: normalized.household,
      memberNames: normalized.memberNames,
      ancestorNames: normalized.ancestorNames,
      spiritNames: normalized.spiritNames,
      status: r.status,
      errors: [...normalized.missingFieldErrors, ...normalized.formatErrors],
      warnings: normalized.warnings,
    };
  });

  return { batchId: batch.id, summary, rows };
}

// ============================================================
// 四、第二步：查看批次
// ============================================================

export type DevoteeImportBatchView = {
  batchId: string;
  fileName: string;
  status: "PREVIEWED" | "COMMITTED";
  summary: DevoteeImportSummary;
  rows: AnalyzedDevoteeRow[];
  createdAt: Date;
  committedAt: Date | null;
};

export async function getDevoteeImportBatch(batchId: string): Promise<DevoteeImportBatchView | null> {
  const batch = await prisma.importBatch.findUnique({
    where: { id: batchId },
    include: { rows: { orderBy: { rowNumber: "asc" } } },
  });
  if (!batch || batch.importKind !== DEVOTEE_IMPORT_KIND) return null;

  // 不論 PREVIEWED 或 COMMITTED，都直接回傳分析／確認匯入當時算出、存進
  // ImportRow 的結果，不需要重新計算（正式格式沒有需要即時查資料庫才能
  // 算出來的狀態，見上方「二、單列狀態判斷」的說明）。
  const rows: AnalyzedDevoteeRow[] = batch.rows.map((r) => {
    const stored = r.rawData as unknown as StoredRowPayload;
    const normalized = deserializeStoredRow(r.rowNumber, stored);
    return {
      id: r.id,
      rowNumber: r.rowNumber,
      household: normalized.household,
      memberNames: normalized.memberNames,
      ancestorNames: normalized.ancestorNames,
      spiritNames: normalized.spiritNames,
      status: r.status,
      errors: (r.errors as string[] | null) ?? [],
      warnings: (r.warnings as string[] | null) ?? [],
    };
  });

  return {
    batchId: batch.id,
    fileName: batch.fileName,
    status: batch.status === "COMMITTED" ? "COMMITTED" : "PREVIEWED",
    summary: buildSummary(batch.rows.map((r) => r.status)),
    rows,
    createdAt: batch.createdAt,
    committedAt: batch.committedAt,
  };
}

// ============================================================
// 五、確認匯入前的再次確認視窗數字（需求「第八步」精神延續，內容依正式
//     格式調整：即將新增／更新家戶數、即將新增的成員／祖先／乙位正魂數
//     —— 這裡的「新增」已經排除掉同一戶底下姓名已經存在的資料）
// ============================================================

export type CommitPreviewResult =
  | {
      ok: true;
      newHouseholdCount: number;
      updateHouseholdCount: number;
      newMemberCount: number;
      newAncestorCount: number;
      newSpiritCount: number;
      skippedCount: number; // 資料不完整／格式錯誤，這次不會處理的列數
      overCap: boolean;
      capMessage: string | null;
    }
  | { ok: false; error: string };

type NameBucket = { members: Set<string>; ancestors: Set<string>; spirits: Set<string> };

/** 把同一個批次裡、同一個家戶編號出現的所有列合併成一組姓名清單（正常情況一戶只會出現一列，這裡多做一層保護）。 */
function groupReadyRowsByHouseholdCode(rows: AnalyzedDevoteeRow[]): Map<string, NameBucket> {
  const byCode = new Map<string, NameBucket>();
  for (const r of rows) {
    const bucket = byCode.get(r.household.code) ?? { members: new Set(), ancestors: new Set(), spirits: new Set() };
    r.memberNames.forEach((n) => bucket.members.add(n));
    r.ancestorNames.forEach((n) => bucket.ancestors.add(n));
    r.spiritNames.forEach((n) => bucket.spirits.add(n));
    byCode.set(r.household.code, bucket);
  }
  return byCode;
}

export async function getCommitPreview(batchId: string): Promise<CommitPreviewResult> {
  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, error: "找不到這個匯入批次" };
  if (view.status === "COMMITTED") return { ok: false, error: "這個批次已經確認匯入過了" };

  const readyRows = view.rows.filter((r) => r.status === "READY_TO_IMPORT");
  const namesByCode = groupReadyRowsByHouseholdCode(readyRows);
  const codes = Array.from(namesByCode.keys());

  const existingHouseholds = await prisma.household.findMany({
    where: { id: { in: codes }, deletedAt: null },
    select: { id: true },
  });
  const existingHouseholdIds = new Set(existingHouseholds.map((h) => h.id));
  const newHouseholdCount = codes.filter((c) => !existingHouseholdIds.has(c)).length;
  const updateHouseholdCount = codes.length - newHouseholdCount;

  let newMemberCount = 0;
  let newAncestorCount = 0;
  let newSpiritCount = 0;
  let totalMemberNameCount = 0;

  for (const [code, bucket] of namesByCode) {
    totalMemberNameCount += bucket.members.size;
    const [existingMembers, existingWorship] = await Promise.all([
      prisma.member.findMany({ where: { householdId: code, deletedAt: null }, select: { name: true } }),
      prisma.worshipRecord.findMany({ where: { householdId: code }, select: { type: true, displayName: true } }),
    ]);
    const existingMemberNames = new Set(existingMembers.map((m) => m.name));
    const existingAncestorNames = new Set(
      existingWorship.filter((w) => w.type === "ANCESTOR_LINE").map((w) => w.displayName)
    );
    const existingSpiritNames = new Set(
      existingWorship.filter((w) => w.type === "INDIVIDUAL").map((w) => w.displayName)
    );

    for (const n of bucket.members) if (!existingMemberNames.has(n)) newMemberCount++;
    for (const n of bucket.ancestors) if (!existingAncestorNames.has(n)) newAncestorCount++;
    for (const n of bucket.spirits) if (!existingSpiritNames.has(n)) newSpiritCount++;
  }

  const overCap = codes.length > MAX_TEST_IMPORT_HOUSEHOLDS || totalMemberNameCount > MAX_TEST_IMPORT_MEMBERS;

  return {
    ok: true,
    newHouseholdCount,
    updateHouseholdCount,
    newMemberCount,
    newAncestorCount,
    newSpiritCount,
    skippedCount: view.summary.incompleteData + view.summary.formatError,
    overCap,
    capMessage: overCap
      ? `目前單次最多處理${MAX_TEST_IMPORT_HOUSEHOLDS}戶或${MAX_TEST_IMPORT_MEMBERS}位家戶成員，請縮小範圍分批匯入。`
      : null,
  };
}

// ============================================================
// 六、確認匯入（Transaction 寫入、結果凍結）
// ============================================================

export type CommitDevoteeImportResult =
  | {
      ok: true;
      householdsCreated: number;
      householdsUpdated: number;
      membersCreated: number;
      ancestorsCreated: number;
      spiritsCreated: number;
      skippedCount: number;
      failedCount: number;
      failures: { rowNumber: number; householdName: string | null; error: string }[];
      committedAt: Date;
    }
  | { ok: false; status: number; error: string };

export async function commitDevoteeImport(batchId: string, operatorName?: string | null): Promise<CommitDevoteeImportResult> {
  const preview = await getCommitPreview(batchId);
  if (!preview.ok) return { ok: false, status: 404, error: preview.error };
  if (preview.overCap) return { ok: false, status: 400, error: preview.capMessage! };

  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, status: 404, error: "找不到這個匯入批次" };
  const readyRows = view.rows.filter((r) => r.status === "READY_TO_IMPORT");
  if (readyRows.length === 0) return { ok: false, status: 400, error: "這個批次目前沒有可以匯入的家戶資料" };

  let householdsCreated = 0;
  let householdsUpdated = 0;
  let membersCreated = 0;
  let ancestorsCreated = 0;
  let spiritsCreated = 0;
  const failures: { rowNumber: number; householdName: string | null; error: string }[] = [];
  const importedRowIds: string[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      // 防止重複送出（按鈕連點或兩個分頁同時按下確認匯入）：用「WHERE status
      // = PREVIEWED 才更新」搶佔這個批次，先搶到的那個會把狀態改成
      // COMMITTED，晚到的那個 claimed.count 會是 0，直接中止、整批回滾。
      const claimed = await tx.importBatch.updateMany({
        where: { id: batchId, status: "PREVIEWED" },
        data: { status: "COMMITTED", committedAt: new Date() },
      });
      if (claimed.count === 0) {
        throw new Error("這個批次已經確認匯入過了（可能是重複送出），請重新整理頁面查看結果，不會重複建立資料");
      }

      // 需求指定的建立順序：Household → Member → Ancestor → Spirit。
      // 一列＝一戶，依序處理每一列即可，不需要像舊版一樣先把列分組成戶。
      for (const r of readyRows) {
        const code = r.household.code;

        // 一、Household：依 V12.3 指令七的順序解析家戶編號——
        //   1) 先查目前的 Household.id
        //   2) 沒有就查 HouseholdCodeAlias.oldCode（改過編號或已被合併的舊編號）
        //   3) 命中別名時，更新別名指向的「目前正式家戶」，不可用舊編號另開一戶
        //   4) 都沒命中才建立新家戶
        //
        // ⚠️ 正式 Excel 七欄格式完全沒有改變，使用者手上的檔案照用即可。
        let household = await tx.household.findFirst({ where: { id: code, deletedAt: null } });
        let matchedViaAlias = false;

        if (!household) {
          const alias = await tx.householdCodeAlias.findUnique({
            where: { oldCode: code },
            include: { household: true },
          });
          if (alias?.household && !alias.household.deletedAt) {
            household = alias.household;
            matchedViaAlias = true;
          }
        }

        if (household) {
          const beforeData = household;
          household = await tx.household.update({
            where: { id: household.id },
            data: {
              name: r.household.name,
              contactName: r.household.contactName,
              address: r.household.address,
            },
          });
          await recordVersion(
            {
              entityType: "Household",
              entityId: household.id,
              action: "UPDATE",
              beforeData,
              afterData: household,
              operatorName,
              changeNote: matchedViaAlias
                ? `信眾資料匯入預檢中心：正式匯入（Excel 使用舊家戶編號 ${code}，已對照到目前家戶 ${household.id}，更新基本資料）`
                : "信眾資料匯入預檢中心：正式匯入（家戶編號已存在，更新基本資料）",
            },
            tx
          );
          householdsUpdated++;
        } else {
          // V12.3 指令七.5：這個編號可能屬於「已封存、但沒有合併也沒有別名」
          // 的家戶——直接 create 會撞主鍵（P2002）讓整批匯入失敗。這裡先明確
          // 檢查並丟出可讀的錯誤，要求人工決定恢復、改編號或略過。
          const archived = await tx.household.findUnique({ where: { id: code } });
          if (archived) {
            throw new Error(
              `家戶編號 ${code} 屬於已封存的家戶「${archived.name}」，既沒有合併也沒有編號對照。` +
                `請先從回收區恢復該家戶、或改用其他編號、或把這一列從本次匯入中排除，再重新執行匯入。`
            );
          }

          household = await tx.household.create({
            data: {
              id: code,
              name: r.household.name,
              contactName: r.household.contactName,
              address: r.household.address,
            },
          });
          await recordVersion(
            { entityType: "Household", entityId: household.id, action: "CREATE", afterData: household, operatorName, changeNote: "信眾資料匯入預檢中心：正式匯入" },
            tx
          );
          householdsCreated++;
        }

        // 二、家戶成員：依姓名比對，已存在的略過，只新增找不到的。
        if (r.memberNames.length > 0) {
          const existingMembers = await tx.member.findMany({
            where: { householdId: household.id, deletedAt: null },
            select: { name: true },
          });
          const existingNames = new Set(existingMembers.map((m) => m.name));
          for (const memberName of r.memberNames) {
            if (existingNames.has(memberName)) continue;
            const created = await tx.member.create({ data: { householdId: household.id, name: memberName } });
            await recordVersion(
              { entityType: "Member", entityId: created.id, action: "CREATE", afterData: created, operatorName, changeNote: "信眾資料匯入預檢中心：正式匯入（家戶成員）" },
              tx
            );
            existingNames.add(memberName);
            membersCreated++;
          }
        }

        // 三、歷代祖先：依名稱比對，已存在的略過，只新增找不到的。
        if (r.ancestorNames.length > 0) {
          const existingAncestors = await tx.worshipRecord.findMany({
            where: { householdId: household.id, type: "ANCESTOR_LINE" },
            select: { displayName: true },
          });
          const existingNames = new Set(existingAncestors.map((w) => w.displayName));
          for (const displayName of r.ancestorNames) {
            if (existingNames.has(displayName)) continue;
            const created = await tx.worshipRecord.create({
              data: { householdId: household.id, type: "ANCESTOR_LINE", displayName },
            });
            await recordVersion(
              { entityType: "WorshipRecord", entityId: created.id, action: "CREATE", afterData: created, operatorName, changeNote: "信眾資料匯入預檢中心：正式匯入（歷代祖先）" },
              tx
            );
            existingNames.add(displayName);
            ancestorsCreated++;
          }
        }

        // 四、乙位正魂：依名稱比對，已存在的略過，只新增找不到的。
        if (r.spiritNames.length > 0) {
          const existingSpirits = await tx.worshipRecord.findMany({
            where: { householdId: household.id, type: "INDIVIDUAL" },
            select: { displayName: true },
          });
          const existingNames = new Set(existingSpirits.map((w) => w.displayName));
          for (const displayName of r.spiritNames) {
            if (existingNames.has(displayName)) continue;
            const created = await tx.worshipRecord.create({
              data: { householdId: household.id, type: "INDIVIDUAL", displayName },
            });
            await recordVersion(
              { entityType: "WorshipRecord", entityId: created.id, action: "CREATE", afterData: created, operatorName, changeNote: "信眾資料匯入預檢中心：正式匯入（乙位正魂）" },
              tx
            );
            existingNames.add(displayName);
            spiritsCreated++;
          }
        }

        importedRowIds.push(r.id);
      }

      if (importedRowIds.length > 0) {
        await tx.importRow.updateMany({ where: { id: { in: importedRowIds } }, data: { status: "IMPORTED" } });
      }
      // 確認匯入時仍然不匯入的列（資料不完整／格式錯誤），一律凍結成
      // EXCLUDED，符合「已完成匯入的批次，結果不會被日後資料庫內容改變
      // 影響」——原始的錯誤原因仍保留在 errors 欄位，不會遺失。
      const excludedRowIds = view.rows.filter((r) => !importedRowIds.includes(r.id)).map((r) => r.id);
      if (excludedRowIds.length > 0) {
        await tx.importRow.updateMany({ where: { id: { in: excludedRowIds } }, data: { status: "EXCLUDED" } });
      }

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
    householdsUpdated,
    membersCreated,
    ancestorsCreated,
    spiritsCreated,
    skippedCount: view.rows.length - readyRows.length,
    failedCount: failures.length,
    failures,
    committedAt: committedBatch?.committedAt ?? new Date(),
  };
}

// ============================================================
// 七、匯入結果：錯誤清單匯出
// ============================================================

export async function buildDevoteeImportErrorCsv(batchId: string): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, error: "找不到這個匯入批次" };

  const problemRows = view.rows.filter((r) => r.status === "INCOMPLETE_DATA" || r.status === "FORMAT_ERROR");
  const header = ["原始列號", "家戶編號", "戶名", "錯誤原因", "原始資料摘要"];
  const lines = [header.join(",")];
  for (const r of problemRows) {
    const reasons = r.errors.join("；");
    const summary = `主要聯絡人:${r.household.contactName ?? "（無）"} 地址:${r.household.address ?? "（無）"} 家戶成員:${r.memberNames.join("、") || "（無）"}`;
    const cells = [String(r.rowNumber), r.household.code || "（無）", r.household.name || "（無）", reasons, summary].map(csvEscape);
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
