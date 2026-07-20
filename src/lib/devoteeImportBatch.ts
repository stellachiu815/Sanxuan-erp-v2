import { Prisma, type ImportRowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  normalizeAndValidateDevoteeRow,
  type NormalizedDevoteeRow,
  type NormalizedHouseholdFields,
} from "@/lib/devoteeImportValidate";
import { forwardFillAndGroupHouseholdRows } from "@/lib/devoteeImportNormalize";
import {
  parsePersonSheet,
  buildPersonLookup,
  lookupPerson,
} from "@/lib/devoteeImportPersonSheet";
import {
  matchIncomingMember,
  buildMemberMatchWhere,
  type IncomingMember,
  type ExistingMemberForMatch,
  type MemberMatchCandidate,
  type MatchConfidence,
} from "@/lib/devoteeImportMemberMatch";
import { setPrimaryContact } from "@/lib/householdPrimaryContact";
import { syncMemberHouseholdReferences, describeSyncCounts } from "@/lib/householdReferenceSync";

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

/**
 * V12.7：**單次匯入筆數上限已移除。**
 *
 * 舊值 MAX_TEST_IMPORT_HOUSEHOLDS = 10／MAX_TEST_IMPORT_MEMBERS = 30 是
 * V11.3 試營運階段的保護，正式資料是 869 戶／1267 位信眾，那個上限會讓
 * 使用者被迫手動切 Excel 分批匯入，不可接受。
 *
 * 取代方案是「分批交易」——使用者仍然只按一次【確認匯入】，後端把工作切成
 * 每批 DEFAULT_COMMIT_CHUNK_SIZE 戶、各自獨立 transaction 完成，前端自動
 * 續批並顯示進度。詳見 commitDevoteeImport()。
 *
 * ⚠️ 為什麼一定要分批，不能一個大 transaction 包住 869 戶：
 *   1. Prisma 互動式交易預設 timeout 只有 5 秒（我們調高到 120 秒仍不夠）。
 *   2. 每一戶大約 26 次資料庫往返（查家戶／別名／成員比對／建立／版本紀錄
 *      …），869 戶就是兩萬次以上，單一交易會長時間持有大量列鎖。
 *   3. Render 的 HTTP 請求也有逾時上限，單一請求跑完兩萬次查詢並不實際。
 */
export const DEFAULT_COMMIT_CHUNK_SIZE = 50;

/** 交易 timeout（毫秒）。一批 50 戶約 1300 次查詢，給足裕度避免誤判失敗。 */
export const COMMIT_TRANSACTION_TIMEOUT_MS = 120_000;
export const COMMIT_TRANSACTION_MAX_WAIT_MS = 20_000;

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
  /** V12.6：預檢算出的預計動作計畫。舊批次沒有這個欄位，讀取時要容忍 undefined。 */
  plan?: RowPlan;
};

/**
 * 正式格式的家戶／成員／祖先／乙位正魂欄位全部都是文字，沒有日期等需要
 * 特殊序列化的型別，所以跟舊版比起來，這裡的存取格式單純很多——直接把
 * 正規化結果存進既有的 rawData Json 欄位（沿用既有欄位，不新增 Prisma
 * 欄位）。
 */
function serializeRowForStorage(row: NormalizedDevoteeRow, plan?: RowPlan): StoredRowPayload {
  return {
    raw: toJsonSafeRow(row.raw),
    normalized: {
      household: row.household,
      memberNames: row.memberNames,
      ancestorNames: row.ancestorNames,
      spiritNames: row.spiritNames,
    },
    ...(plan ? { plan } : {}),
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
  /** V12.6 指令六：預檢分類。以下由 rowPlan 統計，不是 ImportRowStatus 的計數。 */
  suspectedDuplicate: number;
  householdUncertain: number;
  householdsToCreate: number;
  householdsToUpdate: number;
  membersToCreate: number;
  membersToUpdate: number;
  autoMatchedHighConfidence: number;
  fieldConflicts: number;
};

function buildSummary(statuses: ImportRowStatus[], plans: RowPlan[] = []): DevoteeImportSummary {
  const count = (s: ImportRowStatus) => statuses.filter((x) => x === s).length;
  const sum = (f: (p: RowPlan) => number) => plans.reduce((a, p) => a + f(p), 0);
  return {
    total: statuses.length,
    readyToImport: count("READY_TO_IMPORT"),
    incompleteData: count("INCOMPLETE_DATA"),
    formatError: count("FORMAT_ERROR"),
    excluded: count("EXCLUDED"),
    imported: count("IMPORTED"),
    suspectedDuplicate: count("SUSPECTED_DUPLICATE"),
    householdUncertain: count("HOUSEHOLD_UNCERTAIN"),
    householdsToCreate: plans.filter((p) => p.householdAction === "CREATE").length,
    householdsToUpdate: plans.filter((p) => p.householdAction === "UPDATE").length,
    membersToCreate: sum((p) => p.members.filter((m) => m.action === "CREATE").length),
    membersToUpdate: sum((p) => p.members.filter((m) => m.action === "UPDATE").length),
    autoMatchedHighConfidence: sum(
      (p) => p.members.filter((m) => m.action === "UPDATE" && m.confidence === "HIGH").length
    ),
    fieldConflicts: sum((p) => p.fieldConflicts.length),
  };
}

/**
 * V12.6 指令六：每一列的「預計動作」計畫。
 *
 * 這是預檢階段算出來、存進 ImportRow.rawData 的判斷結果，讓畫面可以顯示
 * 「Excel 列號／原始資料／系統既有資料／預計動作／問題原因／可選處理方式」，
 * 也讓 commit 階段不必重算一次。**計畫本身不寫入任何正式資料。**
 */
export type RowPlan = {
  rowNumber: number;
  householdAction: "CREATE" | "UPDATE" | "BLOCKED";
  /** UPDATE 時，實際對應到的既有家戶（可能是透過舊編號 alias 找到的） */
  matchedHouseholdId: string | null;
  matchedViaAlias: boolean;
  /** 既有家戶目前的值，供畫面做「原始資料 vs 系統既有資料」對照 */
  existingHousehold: { name: string; contactName: string | null; address: string | null } | null;
  /** 欄位衝突：Excel 有值、既有也有值且不同 */
  fieldConflicts: { field: string; excelValue: string; existingValue: string }[];
  /** Excel 空白但既有有值 → 預設保留既有（指令二），列出來讓使用者知道 */
  keptExistingFields: string[];
  members: PlannedMember[];
  blockedReason: string | null;
  /**
   * V12.6 指令二：使用者在預檢中心明確勾選「以 Excel 為準，空白也覆蓋」。
   * 預設 false＝空白保留既有資料。
   */
  overwriteBlanks?: boolean;
};

/**
 * V12.6 驗收修正：使用者對「需人工確認」成員做出的決定。
 *
 * ⚠️ 為什麼存在 plan（rawData Json）裡而不是只用 ImportRow 的三個
 * resolution 欄位：ImportRow 的 resolutionDecision／resolutionMemberId 是
 * **一列一個**，但正式七欄一列＝一戶、一戶可能有多位成員各自需要決定
 * （例如三位同名成員分屬不同情況）。所以逐成員的決定存在這裡，同時把
 * 「這一列的代表性決定」鏡射到既有的 ImportRow.resolutionDecision／
 * resolutionHouseholdId／resolutionMemberId 三個欄位（指令二要求寫入既有
 * 欄位），兩邊都有，不需要任何 migration。
 */
export type MemberResolution = {
  /**
   * KEEP_ORIGINAL  保留原家戶，不移動（不建立、不搬動）
   * TRANSFER_IN    轉入目前家戶（把既有成員搬過來）
   * CREATE_NEW     建立為新信眾（視為不同人）
   * SKIP           略過此人
   */
  decision: "KEEP_ORIGINAL" | "TRANSFER_IN" | "CREATE_NEW" | "SKIP";
  /** KEEP_ORIGINAL／TRANSFER_IN 時，使用者選定的既有成員 */
  memberId: string | null;
  /** 該成員原本所屬家戶（供紀錄與 ImportRow.resolutionHouseholdId 鏡射） */
  householdId: string | null;
  decidedAt: string;
  decidedByName: string | null;
};

export type PlannedMember = {
  name: string;
  action: "CREATE" | "UPDATE" | "REVIEW" | "SKIP";
  confidence: MatchConfidence | null;
  reason: string;
  candidates: MemberMatchCandidate[];
  /** 來自個人 Excel 的補充欄位（沒有個人檔時為 null） */
  personData: IncomingMember | null;
  /** V12.6 驗收修正：人工決定（尚未決定時為 null） */
  resolution?: MemberResolution | null;
};

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
  /** V12.6：預計動作計畫（舊批次沒有這個欄位時為 null） */
  plan: RowPlan | null;
};

// ============================================================
// 三、第一步：分析（上傳＋欄位對照後，預覽，不寫入正式資料）
// ============================================================

export async function analyzeDevoteeImport(
  fileName: string,
  rawRows: Record<string, unknown>[],
  mapping: Record<string, string | null>,
  /**
   * V12.6 指令四／五：可選的第二份「個人資料 Excel」。
   *
   * 它**不會產生自己的 ImportRow**——解析後依姓名（＋家戶編號）掛回家戶列的
   * 成員上，用來補足手機／市話／Email／生日／地址，讓指令三的多欄比對有
   * 資料可用。沒有上傳這一份時，比對會退化成「只有姓名」，此時同名一律
   * 列為疑似重複交人工確認（而不是自動略過或自動建立）。
   */
  personRawRows?: Record<string, unknown>[]
): Promise<{
  batchId: string;
  summary: DevoteeImportSummary;
  rows: AnalyzedDevoteeRow[];
  /** V12.8：合併儲存格前處理的結果，供畫面說明「N 列合併成 M 戶」 */
  sheetPreparation: { excelRowCount: number; householdRowCount: number; mergedRowCount: number };
}> {
  /**
   * V12.8：**所有驗證之前**先做合併儲存格前處理。
   *
   * 正式家戶 Excel 用合併儲存格，一戶橫跨多列、家戶層級欄位只有第一列有值。
   * 這裡先 forward fill 家戶層級欄位，並把同一戶的多列合併成一列，讓後面
   * 的欄位驗證／預檢分類／人工確認／正式匯入完全沿用既有的「一列＝一戶」
   * 流程，不需要任何改動。詳見 forwardFillAndGroupHouseholdRows() 的說明。
   */
  const prepared = forwardFillAndGroupHouseholdRows(rawRows, mapping);
  const normalizedRows = prepared.rows.map((p) =>
    normalizeAndValidateDevoteeRow(p.raw, mapping, p.rowNumber)
  );

  // ---- 個人 Excel（可選）----
  const personRows = personRawRows?.length ? parsePersonSheet(personRawRows) : [];
  const personLookup = buildPersonLookup(personRows);
  const personFormatErrors = personRows.flatMap((p) =>
    p.formatErrors.map((e) => `個人資料第 ${p.rowNumber} 列（${p.name}）：${e}`)
  );

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

  // V12.6 指令二：判斷「欄位衝突」與「空白不覆蓋」需要既有家戶的完整欄位。
  // 目標可能是編號直接命中的那一戶，也可能是透過舊編號 alias 對照到的那一戶。
  const targetHouseholdIds = Array.from(
    new Set([
      ...existingHouseholds.filter((h) => !h.deletedAt).map((h) => h.id),
      ...aliases.filter((a) => a.household && !a.household.deletedAt).map((a) => a.householdId),
    ])
  );
  const existingHouseholdDetail = new Map(
    (targetHouseholdIds.length
      ? await prisma.household.findMany({
          where: { id: { in: targetHouseholdIds } },
          select: { id: true, name: true, contactName: true, address: true },
        })
      : []
    ).map((h) => [h.id, h])
  );

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

  // ---- V12.6 指令三：成員多欄比對所需的既有資料（一次撈完，避免逐列查詢）----
  const allMemberNames = Array.from(new Set(normalizedRows.flatMap((n) => n.memberNames)));
  const existingMembersRaw = allMemberNames.length
    ? await prisma.member.findMany({
        where: buildMemberMatchWhere(allMemberNames),
        select: {
          id: true,
          name: true,
          householdId: true,
          solarBirthDate: true,
          lunarBirthYear: true,
          lunarBirthMonth: true,
          lunarBirthDay: true,
          lunarIsLeapMonth: true,
          household: { select: { name: true, phone: true, address: true } },
          devoteeProfile: { select: { mobile: true } },
        },
      })
    : [];
  const existingMembers: ExistingMemberForMatch[] = existingMembersRaw.map((m) => ({
    id: m.id,
    name: m.name,
    householdId: m.householdId,
    householdName: m.household.name,
    mobile: m.devoteeProfile?.mobile ?? null,
    householdPhone: m.household.phone,
    householdAddress: m.household.address,
    solarBirthDate: m.solarBirthDate,
    lunarBirthYear: m.lunarBirthYear,
    lunarBirthMonth: m.lunarBirthMonth,
    lunarBirthDay: m.lunarBirthDay,
    lunarIsLeapMonth: m.lunarIsLeapMonth,
  }));
  const existingByName = new Map<string, ExistingMemberForMatch[]>();
  for (const m of existingMembers) {
    const list = existingByName.get(m.name) ?? [];
    list.push(m);
    existingByName.set(m.name, list);
  }

  /** 建立這一列的預計動作計畫（指令六）。純判斷，不寫入任何資料。 */
  function buildRowPlan(normalized: (typeof normalizedRows)[number], blockedReason: string | null): RowPlan {
    const code = normalized.household.code;
    const direct = existingByCode.get(code);
    const alias = aliasByCode.get(code);
    const target =
      direct && !direct.deletedAt
        ? { id: direct.id, name: direct.name }
        : alias?.household && !alias.household.deletedAt
          ? { id: alias.household.id, name: alias.household.name }
          : null;

    const existingFull = target ? existingHouseholdDetail.get(target.id) ?? null : null;

    // 欄位衝突／空白保留（指令二：空白欄位不可覆蓋既有有效資料）
    const fieldConflicts: RowPlan["fieldConflicts"] = [];
    const keptExistingFields: string[] = [];
    if (existingFull) {
      const pairs: { field: string; excel: string | null; existing: string | null }[] = [
        { field: "戶名", excel: normalized.household.name || null, existing: existingFull.name },
        { field: "主要聯絡人", excel: normalized.household.contactName, existing: existingFull.contactName },
        { field: "地址", excel: normalized.household.address, existing: existingFull.address },
      ];
      for (const p of pairs) {
        if (!p.excel && p.existing) keptExistingFields.push(p.field);
        else if (p.excel && p.existing && p.excel !== p.existing) {
          fieldConflicts.push({ field: p.field, excelValue: p.excel, existingValue: p.existing });
        }
      }
    }

    // 成員比對
    const targetHouseholdId = target?.id ?? code;
    const members: PlannedMember[] = normalized.memberNames.map((name) => {
      const person = lookupPerson(personLookup, code, name);
      const incoming: IncomingMember = {
        name,
        mobile: person?.mobile ?? null,
        phone: person?.phone ?? null,
        solarBirthDate: person?.solarBirthDate ?? null,
        lunarBirthYear: person?.lunarBirthYear ?? null,
        lunarBirthMonth: person?.lunarBirthMonth ?? null,
        lunarBirthDay: person?.lunarBirthDay ?? null,
        lunarIsLeapMonth: person?.lunarIsLeapMonth ?? false,
        address: person?.address ?? normalized.household.address,
      };
      const result = matchIncomingMember(incoming, targetHouseholdId, existingByName.get(name) ?? []);
      const action: PlannedMember["action"] =
        result.suggestion === "CREATE"
          ? "CREATE"
          : result.suggestion === "SKIP_SAME_PERSON"
            ? person
              ? "UPDATE" // 有個人資料可以補進既有成員
              : "SKIP"
            : "REVIEW";
      return {
        name,
        action,
        confidence: result.candidates[0]?.confidence ?? null,
        reason: result.reason,
        candidates: result.candidates,
        personData: person ? incoming : null,
      };
    });

    return {
      rowNumber: normalized.rowNumber,
      householdAction: blockedReason ? "BLOCKED" : target ? "UPDATE" : "CREATE",
      matchedHouseholdId: target?.id ?? null,
      matchedViaAlias: Boolean(!direct && alias?.household),
      existingHousehold: existingFull
        ? { name: existingFull.name, contactName: existingFull.contactName, address: existingFull.address }
        : null,
      fieldConflicts,
      keptExistingFields,
      members,
      blockedReason,
    };
  }

  const rowsToCreate = normalizedRows.map((normalized) => {
    const codeCheck = inspectHouseholdCode(normalized.household.code || "");
    const plan = buildRowPlan(normalized, codeCheck.errors[0] ?? null);

    /**
     * V12.6 驗收修正：必填缺漏的判定要看「這一戶是新增還是更新」。
     *
     * devoteeImportValidate.ts 是純函式、不查資料庫，所以它把「戶名」與
     * 「家戶成員」空白一律當成必填缺漏。但對**已存在的家戶**來說，這兩欄
     * 空白的正確語意是「這次不異動」，跟主要聯絡人／地址空白完全一樣——
     * 依指令二「空白欄位不可覆蓋既有有效資料」，本來就該保留既有值，
     * 不應該被歸類成阻擋匯入的必填缺漏。
     *
     * 因此這裡在知道「有沒有對應到既有家戶」之後重新判定：
     *   家戶編號空白 → 永遠阻擋（沒有編號就無法識別要更新哪一戶）
     *   戶名／家戶成員空白 → 只有「新增家戶」時才阻擋；更新既有家戶時
     *                        降級為提醒，並保留既有資料
     */
    const isUpdatingExisting = plan.householdAction === "UPDATE";
    const blockingMissing = normalized.missingFieldErrors.filter((e) => {
      if (e.includes("家戶編號")) return true;
      return !isUpdatingExisting;
    });
    const downgradedMissing = normalized.missingFieldErrors.filter((e) => !blockingMissing.includes(e));

    // V12.6 指令六：狀態分類。優先序＝格式錯誤 > 必填缺漏 > 疑似重複 > 可匯入。
    let status: ImportRowStatus;
    if (codeCheck.errors.length > 0 || normalized.formatErrors.length > 0) {
      status = "FORMAT_ERROR";
    } else if (blockingMissing.length > 0) {
      status = "INCOMPLETE_DATA";
    } else if (plan.members.some((m) => m.action === "REVIEW")) {
      // 有成員需要人工判斷（同名但證據不足、或已在別戶）→ 疑似重複，
      // 預設不匯入，等人工在預檢中心做決定（指令三）。
      status = "SUSPECTED_DUPLICATE";
    } else {
      status = "READY_TO_IMPORT";
    }

    const memberWarnings = plan.members
      .filter((m) => m.action === "REVIEW")
      .map((m) => `成員「${m.name}」：${m.reason}`);
    const conflictWarnings = plan.fieldConflicts.map(
      (c) => `「${c.field}」Excel 為「${c.excelValue}」，系統既有為「${c.existingValue}」，匯入後會以 Excel 為準。`
    );
    const keptWarnings = plan.keptExistingFields.length
      ? [`Excel 未填「${plan.keptExistingFields.join("、")}」，將保留系統既有資料，不會被清空。`]
      : [];

    return {
      rowNumber: normalized.rowNumber,
      householdId: normalized.household.code || "",
      // 既有欄位（ImportRow.memberName）沿用來存「這一列的顯示用名稱」，
      // 正式格式一列＝一戶，所以存戶名（不是信眾姓名），供錯誤清單顯示用。
      memberName: normalized.household.name || null,
      rawData: serializeRowForStorage(normalized, plan) as unknown as Prisma.InputJsonValue,
      status,
      // 只有真正阻擋匯入的才放進 errors；被降級的空白欄位改放 warnings，
      // 讓畫面不會把「保留既有資料」誤顯示成錯誤。
      errors: [...blockingMissing, ...normalized.formatErrors, ...codeCheck.errors],
      warnings: [
        ...normalized.warnings,
        ...codeCheck.warnings,
        ...downgradedMissing.map(
          (e) => `${e.replace("缺少必填欄位", "Excel 未填")}——這一戶已存在，將保留系統既有資料，不影響匯入。`
        ),
        ...memberWarnings,
        ...conflictWarnings,
        ...keptWarnings,
      ],
    };
  });

  const rowPlans: RowPlan[] = rowsToCreate.map(
    (r) => (r.rawData as unknown as StoredRowPayload).plan!
  );
  const summary = buildSummary(rowsToCreate.map((r) => r.status), rowPlans);

  const batch = await prisma.importBatch.create({
    data: {
      fileName,
      importKind: DEVOTEE_IMPORT_KIND,
      status: "PREVIEWED",
      totalRows: rowsToCreate.length,
      okCount: summary.readyToImport,
      errorCount: summary.formatError + summary.incompleteData,
      // V12.6：正式格式現在也有「疑似重複」了（成員層級的多欄比對），
      // 沿用既有欄位記錄筆數，不新增欄位。
      duplicateCount: summary.suspectedDuplicate,
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
      plan: rowPlans[i] ?? null,
    };
  });

  return {
    batchId: batch.id,
    summary,
    rows,
    sheetPreparation: {
      excelRowCount: rawRows.length,
      householdRowCount: prepared.rows.length,
      mergedRowCount: prepared.mergedRowCount,
    },
  };
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
      plan: stored.plan ?? null,
      status: r.status,
      errors: (r.errors as string[] | null) ?? [],
      warnings: (r.warnings as string[] | null) ?? [],
    };
  });

  return {
    batchId: batch.id,
    fileName: batch.fileName,
    status: batch.status === "COMMITTED" ? "COMMITTED" : "PREVIEWED",
    // V12.6：分類統計需要 plan（存在 rawData 裡），舊批次沒有 plan 時退化成
    // 只有 status 的計數，不會壞掉。
    summary: buildSummary(
      batch.rows.map((r) => r.status),
      rows.map((r) => r.plan).filter((p): p is RowPlan => Boolean(p))
    ),
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
      /** V12.6 驗收修正：尚未完成人工確認的成員數，>0 時畫面必須停用正式匯入 */
      pendingResolutions: number;
      /** V12.7：單次筆數上限已移除，這兩個欄位固定為 false／null（保留以相容既有型別） */
      overCap: boolean;
      capMessage: string | null;
      /** V12.7：可匯入的家戶總數，供前端顯示「N / 總數」進度 */
      totalHouseholds: number;
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

  return {
    ok: true,
    newHouseholdCount,
    updateHouseholdCount,
    newMemberCount,
    newAncestorCount,
    newSpiritCount,
    skippedCount: view.summary.incompleteData + view.summary.formatError,
    pendingResolutions: await countPendingResolutions(batchId),
    // V12.7：單次筆數上限已移除，改用分批交易處理任意筆數（見
    // DEFAULT_COMMIT_CHUNK_SIZE）。這兩個欄位保留成固定值，是為了不破壞
    // 既有呼叫端與前端型別；下一次整理時可以一併移除。
    overCap: false,
    capMessage: null,
    /** V12.7：這個批次總共要處理幾戶，供前端顯示進度分母 */
    totalHouseholds: view.rows.filter((r) => r.status === "READY_TO_IMPORT").length,
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
      /** V12.6：以個人資料 Excel 補足既有成員空白欄位的筆數 */
      membersUpdated: number;
      ancestorsCreated: number;
      spiritsCreated: number;
      skippedCount: number;
      failedCount: number;
      failures: { rowNumber: number; householdName: string | null; error: string }[];
      committedAt: Date;
      /** V12.7：這個批次是否已經全部處理完；false 代表前端要再呼叫一次繼續下一批 */
      done: boolean;
      /** V12.7：目前累計已處理的家戶數（分母是 totalHouseholds） */
      processedHouseholds: number;
      /** V12.7：這個匯入批次總共要處理幾戶 */
      totalHouseholds: number;
      /** V12.7：還剩幾戶沒處理 */
      remainingHouseholds: number;
    }
  | { ok: false; status: number; error: string };

/**
 * V12.7：全部批次都跑完之後的收尾。
 *
 * 只有在「沒有任何 READY_TO_IMPORT 的列」時才會真正收尾：
 *   1. 把仍未匯入的列（資料不完整／格式錯誤／使用者選擇略過）凍結成 EXCLUDED
 *   2. 把批次標成 COMMITTED
 *
 * 分批進行中重複呼叫是安全的——條件不成立就什麼都不做。
 */
async function finalizeBatchIfComplete(batchId: string): Promise<void> {
  const stillPending = await prisma.importRow.count({
    where: { batchId, status: "READY_TO_IMPORT" },
  });
  if (stillPending > 0) return;

  await prisma.$transaction(async (tx) => {
    await tx.importRow.updateMany({
      where: { batchId, status: { notIn: ["IMPORTED", "EXCLUDED"] } },
      data: { status: "EXCLUDED" },
    });
    await tx.importBatch.updateMany({
      where: { id: batchId, status: "PREVIEWED" },
      data: { status: "COMMITTED", committedAt: new Date() },
    });
  });
}

/**
 * 確認匯入（V12.7 起支援任意筆數）。
 *
 * ── 使用者體驗 ──
 * 使用者永遠只按一次【確認匯入】。分批完全發生在系統內部：前端會自動
 * 連續呼叫這支函式直到 `done === true`，中間依 `processedHouseholds /
 * totalHouseholds` 顯示進度。
 *
 * ── 為什麼分批 ──
 * 見 DEFAULT_COMMIT_CHUNK_SIZE 的說明（交易 timeout／鎖持有時間／HTTP 逾時）。
 *
 * ── 資料安全 ──
 * **每一批都是一個完整的 Prisma transaction**：該批任何一戶失敗，整批回滾，
 * 不會留下半戶資料。已成功的前幾批維持已寫入（這是分批交易的本質），
 * 回傳值會明確標示已處理／剩餘筆數，失敗原因也會逐列列出。
 *
 * ── 續傳與冪等 ──
 * 每批處理完會把該批的列標成 IMPORTED，下一次呼叫只會撈仍是
 * READY_TO_IMPORT 的列。所以中途失敗後重新按一次，會從沒做完的地方接續，
 * 不會重複建立已匯入的家戶。
 */
export async function commitDevoteeImport(
  batchId: string,
  operatorName?: string | null,
  options: { chunkSize?: number } = {}
): Promise<CommitDevoteeImportResult> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_COMMIT_CHUNK_SIZE);

  /**
   * ⚠️ V12.7 效能：這裡刻意**不呼叫 getCommitPreview()**。
   *
   * getCommitPreview() 會逐戶查詢既有家戶／成員／牌位來估算「即將新增幾筆」，
   * 對 869 戶而言是兩千多次查詢。分批匯入會呼叫 commitDevoteeImport() 十幾
   * 次，如果每次都重算一遍預覽，整體就變成 O(n²)、慢到不可用。
   *
   * 這裡只需要「這個批次存在、而且還沒被標記完成」這個前提，用一次輕量
   * 查詢就夠了。預覽數字由前端在按下確認之前取得一次即可。
   */
  const batchMeta = await prisma.importBatch.findUnique({
    where: { id: batchId },
    select: { id: true, importKind: true, status: true },
  });
  if (!batchMeta || batchMeta.importKind !== DEVOTEE_IMPORT_KIND) {
    return { ok: false, status: 404, error: "找不到這個匯入批次" };
  }
  if (batchMeta.status === "COMMITTED") {
    return { ok: false, status: 400, error: "這個批次已經確認匯入過了" };
  }

  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, status: 404, error: "找不到這個匯入批次" };
  /**
   * V12.6 驗收修正（指令四）：還有未完成的人工確認時，一律不允許正式匯入。
   *
   * 這是後端的硬性把關，不只靠前端停用按鈕——否則有人直接打 API 就會把
   * 「疑似重複」的列略過寫入，等於繞過人工確認。
   */
  const pendingResolutions = await countPendingResolutions(batchId);
  if (pendingResolutions > 0) {
    return {
      ok: false,
      status: 409,
      error: `還有 ${pendingResolutions} 位成員的疑似重複尚未確認處理方式，請先在預檢畫面逐一確認後再執行正式匯入。`,
    };
  }

  /**
   * V12.7：只取「這一批」要處理的列。
   *
   * 已經匯入過的列狀態是 IMPORTED，不會再被撈出來——這讓分批天然可以續傳，
   * 而且重複按下確認匯入也不會重複建立資料。
   */
  const remainingRows = view.rows.filter((r) => r.status === "READY_TO_IMPORT");
  const alreadyImported = view.rows.filter((r) => r.status === "IMPORTED").length;

  if (remainingRows.length === 0) {
    // 全部做完了（或這個批次本來就沒有可匯入的列）
    if (alreadyImported > 0) {
      await finalizeBatchIfComplete(batchId);
      const committed = await prisma.importBatch.findUnique({ where: { id: batchId } });
      return {
        ok: true,
        householdsCreated: 0,
        householdsUpdated: 0,
        membersCreated: 0,
        membersUpdated: 0,
        ancestorsCreated: 0,
        spiritsCreated: 0,
        skippedCount: view.rows.length - alreadyImported,
        failedCount: 0,
        failures: [],
        committedAt: committed?.committedAt ?? new Date(),
        done: true,
        processedHouseholds: alreadyImported,
        totalHouseholds: alreadyImported,
        remainingHouseholds: 0,
      };
    }
    return { ok: false, status: 400, error: "這個批次目前沒有可以匯入的家戶資料" };
  }

  const readyRows = remainingRows.slice(0, chunkSize);

  let householdsCreated = 0;
  let householdsUpdated = 0;
  let membersCreated = 0;
  let membersUpdated = 0;
  const touchedHouseholdIds = new Set<string>();
  let ancestorsCreated = 0;
  let spiritsCreated = 0;
  const failures: { rowNumber: number; householdName: string | null; error: string }[] = [];
  const importedRowIds: string[] = [];

  try {
    await prisma.$transaction(
      async (tx) => {
      /**
       * V12.7：防重複送出的機制改變。
       *
       * 舊做法是「第一次進來就把批次標成 COMMITTED」搶佔，但分批匯入時
       * 第一批就標記完成會讓後續批次全部被擋掉。改成 **row-level 冪等**：
       *
       *   - 每批只處理仍是 READY_TO_IMPORT 的列，處理完立刻標成 IMPORTED
       *   - 兩個分頁同時送出時，各自搶到不同的列；重疊的部分因為狀態已經
       *     不是 READY_TO_IMPORT，第二個交易的 updateMany 會更新 0 筆，
       *     不會重複建立資料
       *   - 全部列都處理完之後，才由 finalizeBatchIfComplete() 把批次標成
       *     COMMITTED
       */
      const claimed = await tx.importRow.updateMany({
        where: { id: { in: readyRows.map((r) => r.id) }, status: "READY_TO_IMPORT" },
        data: { status: "IMPORTED" },
      });
      if (claimed.count === 0) {
        throw new Error("這一批資料已經被其他視窗匯入了，請重新整理頁面查看目前進度，不會重複建立資料");
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
          /**
           * V12.6 指令二：**空白欄位不可覆蓋既有有效資料**，除非使用者明確
           * 選擇覆蓋。
           *
           * 舊版是無條件寫入三個欄位，Excel 該格留白就會把資料庫既有的
           * 戶名／主要聯絡人／地址清成空值——這是靜默的資料流失。
           *
           * 現在的規則：
           *   Excel 有值 → 以 Excel 為準（預檢已把差異列為「欄位衝突」讓使用者看過）
           *   Excel 空白 → 保留既有值（預檢已列在「保留既有欄位」提醒裡）
           *   除非該列被標記 overwriteBlanks（使用者在預檢中心明確勾選覆蓋）
           */
          const overwriteBlanks = r.plan?.overwriteBlanks === true;
          const keepIfBlank = <T,>(excel: T | null, existing: T | null): T | null =>
            excel !== null && excel !== undefined && excel !== ("" as unknown as T)
              ? excel
              : overwriteBlanks
                ? excel ?? null
                : existing;

          household = await tx.household.update({
            where: { id: household.id },
            data: {
              name: r.household.name || (overwriteBlanks ? r.household.name : beforeData.name),
              contactName: keepIfBlank(r.household.contactName, beforeData.contactName),
              address: keepIfBlank(r.household.address, beforeData.address),
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

        /**
         * 二、家戶成員（V12.6 指令三：多欄比對，不可只用姓名判定同一人）。
         *
         * 這裡**依預檢算好的 plan 執行**，不重算比對——預檢顯示給使用者看的
         * 動作，就是實際會發生的動作，兩者不會不一致。plan 缺席時（舊批次）
         * 退回舊行為，維持向下相容。
         *
         *   CREATE  → 新增成員（＋個人 Excel 提供的欄位）
         *   UPDATE  → 高可信度命中既有成員，用個人 Excel 補足空欄位
         *   SKIP    → 同一戶已有這個人且沒有補充資料，不動
         *   REVIEW  → 需人工確認；這種列的 status 是 SUSPECTED_DUPLICATE，
         *             根本不會進入 readyRows，所以這裡不會遇到
         */
        const plannedMembers = r.plan?.members;
        if (plannedMembers?.length) {
          for (const pm of plannedMembers) {
            if (pm.action === "SKIP") continue;

            /**
             * V12.6 驗收修正：commit 必須依人工決定執行，不可忽略。
             *
             * action === "REVIEW" 的成員一定要有 resolution 才會走到這裡
             * （沒有決定的列狀態仍是 SUSPECTED_DUPLICATE，不會進 readyRows）。
             * 這裡把四種決定映射成實際動作：
             *
             *   KEEP_ORIGINAL 保留原家戶 → 什麼都不做（不建立、不搬動）
             *   SKIP          略過此人   → 什麼都不做
             *   TRANSFER_IN   轉入本戶   → 搬動既有成員，並呼叫既有的
             *                              syncMemberHouseholdReferences()
             *                              同步六張去正規化表（V12.3 服務，
             *                              不複製邏輯）
             *   CREATE_NEW    建立新信眾 → 當成全新成員新增
             */
            if (pm.action === "REVIEW") {
              const res = pm.resolution;
              if (!res) continue; // 防呆：理論上不會發生

              if (res.decision === "KEEP_ORIGINAL" || res.decision === "SKIP") {
                continue;
              }

              if (res.decision === "TRANSFER_IN" && res.memberId) {
                const moving = await tx.member.findUnique({ where: { id: res.memberId } });
                if (!moving || moving.deletedAt) continue;
                if (moving.householdId === household.id) continue; // 已經在本戶

                const before = moving;
                const after = await tx.member.update({
                  where: { id: res.memberId },
                  data: { householdId: household.id },
                });
                // ⚠️ 成員換戶了，六張同時存 memberId 與 householdId 的表必須
                // 一起同步，否則收款／收據／供品會留在舊戶（V12.3 指令一.A）。
                const syncCounts = await syncMemberHouseholdReferences(tx, [res.memberId], household.id);
                await recordVersion(
                  {
                    entityType: "Member",
                    entityId: res.memberId,
                    action: "UPDATE",
                    beforeData: before,
                    afterData: after,
                    operatorName,
                    changeNote: `信眾資料匯入預檢中心：依人工確認，由家戶 ${before.householdId} 轉入 ${household.id}｜同步關聯紀錄：${describeSyncCounts(syncCounts)}`,
                  },
                  tx
                );
                membersUpdated++;
                continue;
              }

              // CREATE_NEW：往下走一般新增流程
            }

            if (pm.action === "CREATE") {
              const created = await tx.member.create({
                data: {
                  householdId: household.id,
                  name: pm.name,
                  ...(pm.personData?.solarBirthDate
                    ? { solarBirthDate: new Date(`${pm.personData.solarBirthDate}T00:00:00.000Z`) }
                    : {}),
                  ...(pm.personData?.lunarBirthYear
                    ? {
                        lunarBirthYear: pm.personData.lunarBirthYear,
                        lunarBirthMonth: pm.personData.lunarBirthMonth,
                        lunarBirthDay: pm.personData.lunarBirthDay,
                        lunarIsLeapMonth: pm.personData.lunarIsLeapMonth,
                      }
                    : {}),
                },
              });
              // 個人 Excel 的手機／Email 寫進既有的 DevoteeProfile（延遲建立）
              if (pm.personData?.mobile) {
                await tx.devoteeProfile.create({
                  data: { memberId: created.id, mobile: pm.personData.mobile },
                });
              }
              await recordVersion(
                {
                  entityType: "Member",
                  entityId: created.id,
                  action: "CREATE",
                  afterData: created,
                  operatorName,
                  changeNote: `信眾資料匯入預檢中心：正式匯入（家戶成員）${pm.personData ? "｜已套用個人資料 Excel 補充欄位" : ""}`,
                },
                tx
              );
              membersCreated++;
              continue;
            }

            // UPDATE：高可信度命中既有成員，只補「目前是空的」欄位，
            // 不覆蓋既有有效資料（指令四：空白資料不得覆蓋現有資料）。
            const targetId = pm.candidates[0]?.memberId;
            if (!targetId || !pm.personData) continue;
            const existing = await tx.member.findUnique({ where: { id: targetId } });
            if (!existing) continue;

            const patch: Prisma.MemberUpdateInput = {};
            if (!existing.solarBirthDate && pm.personData.solarBirthDate) {
              patch.solarBirthDate = new Date(`${pm.personData.solarBirthDate}T00:00:00.000Z`);
            }
            if (!existing.lunarBirthYear && pm.personData.lunarBirthYear) {
              patch.lunarBirthYear = pm.personData.lunarBirthYear;
              patch.lunarBirthMonth = pm.personData.lunarBirthMonth;
              patch.lunarBirthDay = pm.personData.lunarBirthDay;
              patch.lunarIsLeapMonth = pm.personData.lunarIsLeapMonth;
            }
            if (Object.keys(patch).length > 0) {
              const after = await tx.member.update({ where: { id: targetId }, data: patch });
              await recordVersion(
                {
                  entityType: "Member",
                  entityId: targetId,
                  action: "UPDATE",
                  beforeData: existing,
                  afterData: after,
                  operatorName,
                  changeNote: `信眾資料匯入預檢中心：正式匯入（以個人資料 Excel 補足空白欄位，比對依據：${pm.candidates[0]?.matchedFields.join("＋") ?? "姓名"}）`,
                },
                tx
              );
              membersUpdated++;
            }

            if (pm.personData.mobile) {
              const profile = await tx.devoteeProfile.findUnique({ where: { memberId: targetId } });
              if (!profile) {
                await tx.devoteeProfile.create({
                  data: { memberId: targetId, mobile: pm.personData.mobile },
                });
                membersUpdated++;
              } else if (!profile.mobile) {
                await tx.devoteeProfile.update({
                  where: { memberId: targetId },
                  data: { mobile: pm.personData.mobile },
                });
                membersUpdated++;
              }
            }
          }
        } else if (r.memberNames.length > 0) {
          // 向下相容：V12.6 之前建立、rawData 沒有 plan 的舊批次，維持原本
          // 「依姓名比對、已存在的略過」行為，避免舊批次確認匯入時行為改變。
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

        touchedHouseholdIds.add(household.id);
        importedRowIds.push(r.id);
      }

      // V12.7：列狀態已在交易開頭 claim 成 IMPORTED，這裡不需要再更新。
      // 「資料不完整／格式錯誤」的列改由 finalizeBatchIfComplete() 在全部
      // 批次跑完之後一次凍結成 EXCLUDED，避免每一批都重複掃全表。

      /**
       * V12.6 指令七：匯入完成後必須執行既有同步服務——**呼叫既有共用
       * service，不複製邏輯**。
       *
       *   1. Primary Contact Sync（src/lib/householdPrimaryContact.ts）
       *      匯入會新增成員、也會更新家戶的 contactName 文字。若該文字
       *      剛好對應到這一戶的某位成員，就把 Member.isPrimaryContact
       *      旗標同步過去，避免出現「contactName 有值但沒有任何成員被標記
       *      為主要聯絡人」的不一致（V12.3 指令三.5 的規則）。
       *
       *   2. Household Reference Sync（src/lib/householdReferenceSync.ts）
       *      這一輪的匯入**不會把成員從一戶搬到另一戶**——跨戶同名一律被
       *      標成 SUSPECTED_DUPLICATE 擋在 readyRows 之外（指令三：不可
       *      自動轉戶）。沒有成員換戶，六張去正規化表的 householdId 就
       *      沒有需要同步的對象，因此這裡不呼叫 syncMemberHouseholdReferences()。
       *      日後若開放「匯入時可轉戶」，必須在這裡呼叫它。
       *
       *   3. HouseholdCodeAlias：由上方家戶解析階段直接使用（舊編號對照），
       *      匯入本身不會產生新的別名（別名只在改編號／合併時建立）。
       */
      for (const householdId of touchedHouseholdIds) {
        const h = await tx.household.findUnique({
          where: { id: householdId },
          select: { contactName: true },
        });
        if (!h?.contactName) continue;
        const matched = await tx.member.findFirst({
          where: { householdId, name: h.contactName, deletedAt: null },
          select: { id: true },
        });
        if (matched) {
          await setPrimaryContact(tx, householdId, matched.id);
        }
      }

      // V12.7：分批累加（不是覆蓋），才能反映跨批次的累計進度。
      await tx.importBatch.update({
        where: { id: batchId },
        data: { importedRowCount: { increment: importedRowIds.length } },
      });
      },
      {
        // V12.7：Prisma 互動式交易預設只有 5 秒，一批 100 戶約 2600 次查詢
        // 必定超時。這裡放寬到 2 分鐘，並允許較長的取得連線等待時間。
        timeout: COMMIT_TRANSACTION_TIMEOUT_MS,
        maxWait: COMMIT_TRANSACTION_MAX_WAIT_MS,
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "確認匯入時發生錯誤";
    /**
     * V12.7：分批交易下的失敗語意要說清楚。
     *
     * 「這一批」整批回滾，沒有留下半戶資料；但**前面已經成功的批次維持
     * 已寫入**（這是分批交易的本質，也是能處理 869 戶的前提）。訊息明確
     * 標示已完成幾戶，讓行政人員知道現況、可以直接重按繼續。
     */
    return {
      ok: false,
      status: 400,
      error:
        `匯入中斷：這一批（第 ${alreadyImported + 1}–${alreadyImported + readyRows.length} 戶）已完整回滾，沒有寫入任何資料。` +
        `${alreadyImported > 0 ? `先前已成功匯入的 ${alreadyImported} 戶維持不變。` : ""}` +
        `原因：${message}　請修正後再按一次【確認匯入】，系統會從未完成的地方接續，不會重複建立。`,
    };
  }

  // V12.7：這一批做完後，若已經沒有待處理的列就收尾（標成 COMMITTED）。
  await finalizeBatchIfComplete(batchId);

  const committedBatch = await prisma.importBatch.findUnique({ where: { id: batchId } });
  const stillRemaining = await prisma.importRow.count({
    where: { batchId, status: "READY_TO_IMPORT" },
  });
  const processed = alreadyImported + importedRowIds.length;

  return {
    ok: true,
    householdsCreated,
    householdsUpdated,
    membersCreated,
    membersUpdated,
    ancestorsCreated,
    spiritsCreated,
    skippedCount: view.rows.length - remainingRows.length - alreadyImported,
    failedCount: failures.length,
    failures,
    committedAt: committedBatch?.committedAt ?? new Date(),
    done: stillRemaining === 0,
    processedHouseholds: processed,
    totalHouseholds: processed + stillRemaining,
    remainingHouseholds: stillRemaining,
  };
}

// ============================================================
// 六之二、人工確認（V12.6 驗收修正）
// ============================================================

/**
 * 儲存某一列裡某位成員的人工決定。
 *
 * 使用既有的 ImportRow.rawData（plan）與既有的 resolution* 三個欄位，
 * **沒有新增任何 Prisma 欄位或資料表**。決定存進資料庫後重新整理不會消失。
 *
 * 一列所有需要確認的成員都決定完之後，這一列的狀態會從
 * SUSPECTED_DUPLICATE 自動變回 READY_TO_IMPORT，才會被 commit 收進去。
 */
export async function saveMemberResolution(params: {
  batchId: string;
  rowId: string;
  memberName: string;
  decision: MemberResolution["decision"];
  memberId?: string | null;
  operatorName?: string | null;
}): Promise<{ ok: true; status: ImportRowStatus; pendingCount: number } | { ok: false; error: string }> {
  const { batchId, rowId, memberName, decision, memberId, operatorName } = params;

  const row = await prisma.importRow.findFirst({
    where: { id: rowId, batchId },
    include: { batch: { select: { importKind: true, status: true } } },
  });
  if (!row) return { ok: false, error: "找不到這一列匯入資料" };
  if (row.batch.importKind !== DEVOTEE_IMPORT_KIND) return { ok: false, error: "這個批次不是信眾匯入預檢批次" };
  if (row.batch.status === "COMMITTED") return { ok: false, error: "這個批次已經確認匯入，不能再修改人工決定" };

  const stored = row.rawData as unknown as StoredRowPayload;
  const plan = stored.plan;
  if (!plan) return { ok: false, error: "這一列沒有預檢計畫，請重新上傳分析" };

  const target = plan.members.find((m) => m.name === memberName);
  if (!target) return { ok: false, error: `這一列沒有成員「${memberName}」` };
  if (target.action !== "REVIEW") return { ok: false, error: `成員「${memberName}」不需要人工確認` };

  // KEEP_ORIGINAL／TRANSFER_IN 必須指定是哪一位既有成員。
  if ((decision === "KEEP_ORIGINAL" || decision === "TRANSFER_IN") && !memberId) {
    return { ok: false, error: "請先選擇對應的既有信眾" };
  }
  const candidate = memberId ? target.candidates.find((c) => c.memberId === memberId) : null;
  if (memberId && !candidate) return { ok: false, error: "選擇的信眾不在這一位的候選清單內" };

  target.resolution = {
    decision,
    memberId: memberId ?? null,
    householdId: candidate?.householdId ?? null,
    decidedAt: new Date().toISOString(),
    decidedByName: operatorName ?? null,
  };

  // 這一列還有幾位待決定
  const pending = plan.members.filter((m) => m.action === "REVIEW" && !m.resolution).length;
  const nextStatus: ImportRowStatus = pending === 0 ? "READY_TO_IMPORT" : "SUSPECTED_DUPLICATE";

  // 鏡射到既有的 ImportRow.resolution* 三個欄位（取這一列最後一個決定當代表）
  const decisionMap: Record<MemberResolution["decision"], "CONFIRMED_DUPLICATE" | "CONFIRMED_NOT_DUPLICATE" | "ASSIGN_HOUSEHOLD" | "SKIP"> = {
    KEEP_ORIGINAL: "CONFIRMED_DUPLICATE",
    TRANSFER_IN: "ASSIGN_HOUSEHOLD",
    CREATE_NEW: "CONFIRMED_NOT_DUPLICATE",
    SKIP: "SKIP",
  };

  await prisma.importRow.update({
    where: { id: rowId },
    data: {
      rawData: stored as unknown as Prisma.InputJsonValue,
      status: nextStatus,
      resolutionDecision: decisionMap[decision],
      resolutionMemberId: memberId ?? null,
      resolutionHouseholdId: candidate?.householdId ?? null,
      resolutionNote: `成員「${memberName}」：${decision}`,
      resolvedAt: new Date(),
      resolvedByName: operatorName ?? null,
    },
  });

  return { ok: true, status: nextStatus, pendingCount: pending };
}

/** 整個批次還有幾位成員等待人工確認（供畫面停用「正式匯入」按鈕）。 */
export async function countPendingResolutions(batchId: string): Promise<number> {
  const rows = await prisma.importRow.findMany({
    where: { batchId, status: "SUSPECTED_DUPLICATE" },
    select: { rawData: true },
  });
  let pending = 0;
  for (const r of rows) {
    const plan = (r.rawData as unknown as StoredRowPayload).plan;
    if (!plan) continue;
    pending += plan.members.filter((m) => m.action === "REVIEW" && !m.resolution).length;
  }
  return pending;
}

// ============================================================
// 七、匯入結果：錯誤清單匯出
// ============================================================

export async function buildDevoteeImportErrorCsv(batchId: string): Promise<{ ok: true; csv: string } | { ok: false; error: string }> {
  const view = await getDevoteeImportBatch(batchId);
  if (!view) return { ok: false, error: "找不到這個匯入批次" };

  /**
   * V12.6 指令八：匯入報告要涵蓋「每筆錯誤原因」，不只格式錯誤。
   *
   * 因此除了原本的「資料不完整／格式錯誤」，也一併輸出 V12.6 新增的
   * SUSPECTED_DUPLICATE（疑似重複，預設不匯入）與 HOUSEHOLD_UNCERTAIN，
   * 並多帶「狀態／預計動作」兩欄，讓行政人員拿到 CSV 就知道每一列
   * 發生什麼事、要怎麼處理。欄位只增不減，既有欄位順序不變。
   */
  const problemRows = view.rows.filter(
    (r) =>
      r.status === "INCOMPLETE_DATA" ||
      r.status === "FORMAT_ERROR" ||
      r.status === "SUSPECTED_DUPLICATE" ||
      r.status === "HOUSEHOLD_UNCERTAIN"
  );
  const statusLabel: Partial<Record<ImportRowStatus, string>> = {
    INCOMPLETE_DATA: "資料不完整",
    FORMAT_ERROR: "格式錯誤",
    SUSPECTED_DUPLICATE: "疑似重複（需人工確認）",
    HOUSEHOLD_UNCERTAIN: "待確認家戶",
  };
  const header = ["原始列號", "家戶編號", "戶名", "狀態", "預計動作", "錯誤原因", "原始資料摘要"];
  const lines = [header.join(",")];
  for (const r of problemRows) {
    // 疑似重複的原因存在 warnings（errors 是硬性錯誤），兩者都要輸出。
    const reasons = [...r.errors, ...r.warnings].join("；");
    const plannedAction =
      r.plan?.householdAction === "CREATE"
        ? "新增家戶"
        : r.plan?.householdAction === "UPDATE"
          ? `更新既有家戶${r.plan.matchedHouseholdId ? `(${r.plan.matchedHouseholdId})` : ""}`
          : "不會匯入";
    const summary = `主要聯絡人:${r.household.contactName ?? "（無）"} 地址:${r.household.address ?? "（無）"} 家戶成員:${r.memberNames.join("、") || "（無）"}`;
    const cells = [
      String(r.rowNumber),
      r.household.code || "（無）",
      r.household.name || "（無）",
      statusLabel[r.status] ?? r.status,
      plannedAction,
      reasons,
      summary,
    ].map(csvEscape);
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
