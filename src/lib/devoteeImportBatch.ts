import { Prisma, type ImportRowStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isGenderConflict } from "@/lib/genderNormalize";
import { recordVersion, toJsonSnapshot } from "@/lib/recordVersion";
import { randomUUID } from "node:crypto";
import {
  normalizeAndValidateDevoteeRow,
  type NormalizedDevoteeRow,
  type NormalizedHouseholdFields,
} from "@/lib/devoteeImportValidate";
import { forwardFillAndGroupHouseholdRows, toSafeCalendarDate, type TabletMeta } from "@/lib/devoteeImportNormalize";
import {
  parsePersonSheet,
  buildPersonLookup,
  lookupPerson,
  type PersonSheetRow,
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
import { toCalendarDateKey } from "@/lib/devoteeDuplicates";
import {
  computeFieldDiffs,
  classifyRow,
  buildSelectedCorrections,
  isProfileField,
  type FieldDiff,
  type RowCategory,
  type CorrectableField,
  type CorrectionMode,
  type ExcelSideValues,
  type DbSideValues,
} from "@/lib/devoteeImportFieldDiff";
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
 * ⚠️ 為什麼仍要分批，不用一個大 transaction 包住全部：
 *   1. 分批讓失敗影響範圍可控（該批回滾、前面已成功維持），也讓前端能顯示進度。
 *   2. Render 的 HTTP 請求有逾時上限，單一請求不宜跑太久。
 *
 * ⚠️ V24.3：每一批不再是「逐戶逐筆查詢／建立」（舊做法一批 50 戶約 1300+ 次
 * 資料庫往返，遠端資料庫下實測 126 秒 → 互動式交易逾時 → Transaction not found）。
 * 改為「批次預查（4 次）＋ 每種資料一次 createMany ＋ 一次 recordVersion.createMany」，
 * 一批的往返次數與戶數無關（約十餘次），因此可以安全地把每批戶數放大到 200，
 * 減少前端續批的 HTTP 次數，整批 727 戶可在數十秒內完成。
 */
export const DEFAULT_COMMIT_CHUNK_SIZE = 200;

/** 交易 timeout（毫秒）。V24.3 起每批僅十餘次批次往返，120 秒是充足的安全裕度（非用來掩蓋逐筆逾時）。 */
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
    /**
     * V24：牌位隨附資料（陽上姓名／安奉地），依 displayName 對應。與 tabletLocations 一樣，
     * 必須在**預檢階段**先算好落地，commit 只讀 ImportRow 時才有資料可寫 WorshipRecord。
     * 舊批次沒有此欄位（undefined），讀取時容忍為空陣列。
     */
    tabletMeta?: TabletMeta[];
  };
  /** V12.6：預檢算出的預計動作計畫。舊批次沒有這個欄位，讀取時要容忍 undefined。 */
  plan?: RowPlan;
  /**
   * V13.1 指令八：牌位地址（key = 牌位名稱，value = 地址或 null）。
   *
   * ⚠️ 為什麼要在**預檢階段**就算好存起來：
   * 個人 Excel 只存在於分析（analyze）階段，正式匯入（commit）時只讀
   * ImportRow，已經拿不到個人檔了。所以牌位地址必須在這裡先算好落地，
   * commit 才有資料可寫。
   *
   * 舊批次沒有這個欄位（undefined），讀取時一律容忍——那些批次的牌位
   * 地址為 null，屬於待補資料，不會出錯。
   */
  tabletLocations?: Record<string, string | null>;
  /**
   * V24：每筆牌位的陽上姓名（key = 牌位名稱 displayName）。與 tabletLocations 同理，於預檢階段
   * 由家戶檔算好落地，commit 只讀 ImportRow 時才有資料可寫 WorshipRecord.yangshangName。
   * 陽上原文保留、不刪除、不重組。舊批次沒有此欄位時視為無陽上（不覆蓋）。
   */
  tabletYangshang?: Record<string, string>;
};

/**
 * 正式格式的家戶／成員／祖先／乙位正魂欄位全部都是文字，沒有日期等需要
 * 特殊序列化的型別，所以跟舊版比起來，這裡的存取格式單純很多——直接把
 * 正規化結果存進既有的 rawData Json 欄位（沿用既有欄位，不新增 Prisma
 * 欄位）。
 */
function serializeRowForStorage(
  row: NormalizedDevoteeRow,
  plan?: RowPlan,
  tabletLocations?: Record<string, string | null>,
  tabletYangshang?: Record<string, string>
): StoredRowPayload {
  return {
    raw: toJsonSafeRow(row.raw),
    normalized: {
      household: row.household,
      memberNames: row.memberNames,
      ancestorNames: row.ancestorNames,
      spiritNames: row.spiritNames,
      ...(row.tabletMeta.length > 0 ? { tabletMeta: row.tabletMeta } : {}),
    },
    ...(plan ? { plan } : {}),
    ...(tabletLocations && Object.keys(tabletLocations).length > 0 ? { tabletLocations } : {}),
    ...(tabletYangshang && Object.keys(tabletYangshang).length > 0 ? { tabletYangshang } : {}),
  };
}

/**
 * V13.1 指令八：算出這一列所有牌位（歷代祖先＋乙位正魂）的牌位地址。
 *
 * 取值順序：個人 Excel 的「牌位地址」欄 → 個人 Excel 的「地址」欄。
 *
 * ⚠️ 明確**不使用家戶地址遞補**。指令八：牌位地址不得被家戶地址自動覆蓋、
 * 不得視為亡者生前地址或信眾個人地址；空白時保持 NULL、不得自動推測。
 * 留空是合法狀態，會在牌位資料標示為「待補資料」。
 */
function buildTabletLocations(
  row: NormalizedDevoteeRow,
  lookup: ReturnType<typeof buildPersonLookup>
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  const code = row.household.code;
  // V24：家戶檔本身若帶「安奉地」（依 displayName 對應），作為個人 Excel 未提供時的來源。
  const metaAddress = new Map<string, string>();
  for (const m of row.tabletMeta) {
    if (m.address) metaAddress.set(m.displayName, m.address);
  }
  for (const name of [...row.ancestorNames, ...row.spiritNames]) {
    const person = lookupPerson(lookup, code, name);
    // 取值順序：個人 Excel 牌位地址 → 個人 Excel 地址 → 家戶檔安奉地 → null。
    // 一律**不**用家戶地址（Household.address）遞補（既有規則：牌位地址不得被家戶地址覆蓋）。
    out[name] = person?.tabletAddress ?? person?.address ?? metaAddress.get(name) ?? null;
  }
  return out;
}

/** V24：本列各牌位（依 displayName）的陽上姓名。原文保留、不刪除、不重組；無則不設。 */
function buildTabletYangshang(row: NormalizedDevoteeRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of row.tabletMeta) {
    if (m.yangshang) out[m.displayName] = m.yangshang;
  }
  return out;
}

function deserializeStoredRow(rowNumber: number, stored: StoredRowPayload): NormalizedDevoteeRow {
  return {
    rowNumber,
    raw: stored.raw,
    household: stored.normalized.household,
    memberNames: stored.normalized.memberNames,
    ancestorNames: stored.normalized.ancestorNames,
    spiritNames: stored.normalized.spiritNames,
    // commit 階段不需要無效牌位清單（僅分析/預覽階段用於統計）；此處補空陣列以符合型別。
    skippedTablets: [],
    tabletMeta: stored.normalized.tabletMeta ?? [],
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

/**
 * V29 B：使用者在預檢中心對「配對成功成員」勾選要校正的欄位（於 commit / commit-preview 時傳入）。
 *   correctionMode 預設 FILL_BLANK_ONLY（只補空白）；CORRECT_WITH_EXCEL 才允許覆蓋既有非空值。
 *   selectedFields 為勾選要寫入的欄位（未勾選一律不寫）。待確認 row 不得帶入。
 */
export type MemberCorrectionInput = {
  rowId: string;
  memberName: string;
  correctionMode: CorrectionMode;
  selectedFields: CorrectableField[];
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
  /**
   * V13.2：性別衝突說明。
   * null 代表沒有衝突（含「任一邊沒有性別資料」的情況）。
   * 有值時會顯示在預檢畫面，匯入本身不會被阻擋，既有值也不會被覆蓋。
   */
  genderConflict?: string | null;
  /**
   * V29 A：配對成功成員的逐欄 Excel vs DB 差異（memberId 為配對到的既有成員）。
   * 舊批次沒有此欄位（undefined），讀取時容忍。
   */
  matchedMemberId?: string | null;
  fieldDiffs?: FieldDiff[];
  rowCategory?: RowCategory;
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
  /**
   * V13.1 指令八：這一列各個牌位的牌位地址（key = 牌位名稱）。
   * 於預檢階段由個人 Excel 算出並存入 ImportRow，commit 時直接使用。
   * 舊批次沒有這個欄位時為 null。
   */
  tabletLocations: Record<string, string | null> | null;
  /**
   * V24：這一列各個牌位的陽上姓名（key = 牌位名稱）。於預檢階段由家戶檔算出並存入
   * ImportRow，commit 時寫入 WorshipRecord.yangshangName。舊批次沒有這個欄位時為 null。
   */
  tabletYangshang: Record<string, string> | null;
};

// ============================================================
// 三、第一步：分析（上傳＋欄位對照後，預覽，不寫入正式資料）
// ============================================================

/**
 * V29 校正模式：由信眾（個人）Excel 依「家戶編號」分組合成家戶列（僅供成員比對/校正，家戶欄位不動）。
 * 無家戶編號的列略過（不猜測、不建立）——校正模式必須有家戶編號才能安全定位既有成員。
 */
function buildCorrectionNormalizedRows(personRows: PersonSheetRow[]): NormalizedDevoteeRow[] {
  const byCode = new Map<string, PersonSheetRow[]>();
  for (const p of personRows) {
    if (!p.householdCode) continue;
    const list = byCode.get(p.householdCode) ?? [];
    list.push(p);
    byCode.set(p.householdCode, list);
  }
  let rowNumber = 1;
  return [...byCode.entries()].map(([code, persons]) => ({
    rowNumber: rowNumber++,
    raw: {},
    household: { code, name: code, contactName: null, address: null },
    memberNames: [...new Set(persons.map((p) => p.name))],
    ancestorNames: [],
    spiritNames: [],
    skippedTablets: [],
    tabletMeta: [],
    missingFieldErrors: [],
    formatErrors: [],
    warnings: [],
  }));
}

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
  personRawRows?: Record<string, unknown>[],
  /**
   * V29：信眾資料校正模式。true＝**只用信眾（個人）Excel**，略過所有 Household 分析與寫入，
   * 只做 Member／DevoteeProfile 逐欄差異比對與校正。此時 personRawRows 即為上傳的信眾 Excel；
   * 家戶列由個人 Excel 依「家戶編號」分組合成（家戶欄位不建立/不更新）。既有完整匯入模式（false）不變。
   */
  correctionOnly: boolean = false
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
  // ---- 個人（信眾）Excel ----
  const personRows = personRawRows?.length ? parsePersonSheet(personRawRows) : [];

  // V29 校正模式：略過家戶 Excel 前處理，改由信眾 Excel 依家戶編號分組合成家戶列（家戶欄位不動）。
  const normalizedRows: NormalizedDevoteeRow[] = correctionOnly
    ? buildCorrectionNormalizedRows(personRows)
    : forwardFillAndGroupHouseholdRows(rawRows, mapping).rows.map((p) =>
        normalizeAndValidateDevoteeRow(p.raw, mapping, p.rowNumber)
      );
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
          // V13.2：既有性別，供預檢偵測衝突
          gender: true,
          solarBirthDate: true,
          lunarBirthYear: true,
          lunarBirthMonth: true,
          lunarBirthDay: true,
          lunarIsLeapMonth: true,
          // V29：逐欄差異所需的既有值（僅唯讀比對；不改配對邏輯）。
          nationalId: true,
          address: true,
          role: true,
          household: { select: { name: true, phone: true, address: true } },
          devoteeProfile: { select: { mobile: true, email: true } },
        },
      })
    : [];
  // V29：逐欄差異用的既有完整值（memberId → 各可校正欄位現值）。
  const existingFullById = new Map<
    string,
    {
      gender: string | null; solarBirthDate: Date | null;
      lunarBirthYear: number | null; lunarBirthMonth: number | null; lunarBirthDay: number | null; lunarIsLeapMonth: boolean;
      nationalId: string | null; address: string | null; role: string | null;
      mobile: string | null; email: string | null;
    }
  >(
    existingMembersRaw.map((m) => [
      m.id,
      {
        gender: m.gender, solarBirthDate: m.solarBirthDate,
        lunarBirthYear: m.lunarBirthYear, lunarBirthMonth: m.lunarBirthMonth, lunarBirthDay: m.lunarBirthDay, lunarIsLeapMonth: m.lunarIsLeapMonth,
        nationalId: (m as { nationalId: string | null }).nationalId,
        address: (m as { address: string | null }).address,
        role: (m as { role: string | null }).role,
        mobile: m.devoteeProfile?.mobile ?? null,
        email: m.devoteeProfile?.email ?? null,
      },
    ])
  );
  const existingMembers: ExistingMemberForMatch[] = existingMembersRaw.map((m) => ({
    id: m.id,
    name: m.name,
    householdId: m.householdId,
    gender: m.gender,
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
        email: person?.email ?? null,
        phone: person?.phone ?? null,
        solarBirthDate: person?.solarBirthDate ?? null,
        lunarBirthYear: person?.lunarBirthYear ?? null,
        lunarBirthMonth: person?.lunarBirthMonth ?? null,
        lunarBirthDay: person?.lunarBirthDay ?? null,
        lunarIsLeapMonth: person?.lunarIsLeapMonth ?? false,
        // V29：Member.address 只允許來自正式信眾 Excel 的個人通訊地址（person.address）。
        // **不得**用家戶地址遞補（移除舊 `?? normalized.household.address`）。person.address 為空時
        // 一律 null → 下游 create 不寫、update 不覆蓋，Member.address 保持原值；Household.address 另行更新。
        address: person?.address ?? null,
        /**
         * V13.2：性別。唯一來源是個人資料工作表。
         *
         * 家戶 Excel 七欄沒有性別欄位——**這不代表要把性別清空**。
         * 沒有個人檔時為 null，代表「這次匯入沒有帶性別資料」，
         * 下游的更新邏輯會據此保留資料庫既有值（見 commit 階段）。
         */
        gender: person?.gender ?? null,
        // V24：身份→Member.role。個人檔沒有時 null，下游更新一律保留既有值、不覆蓋。
        role: person?.role ?? null,
        // V13.1 指令一：身分證。空白保持 null，不由家戶或其他列推測。
        nationalId: person?.nationalId ?? null,
        // 一般家戶成員沒有牌位地址；牌位地址只在歷代祖先／乙位正魂使用
        // （見下方 buildTabletLocation()）。
        tabletAddress: null,
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
      /**
       * V13.2 第三節之 3：性別衝突偵測。
       *
       * 只有「資料庫既有性別」與「Excel 性別」兩者都有值且不同時才是衝突。
       * 任一邊為空都不算——空白代表「沒有這項資料」，不是「與對方不同」。
       *
       * 衝突時**不靜默覆蓋**：commit 階段會保留既有值，這裡產生的提醒
       * 會顯示在預檢畫面，由使用者決定要不要人工改成新值。
       */
      const matchedExisting = result.candidates[0]?.memberId
        ? existingMembers.find((m) => m.id === result.candidates[0].memberId) ?? null
        : null;
      const genderConflict =
        matchedExisting && isGenderConflict(matchedExisting.gender, incoming.gender)
          ? `「${name}」的性別在系統中是「${matchedExisting.gender}」，Excel 是「${incoming.gender}」。` +
            `匯入不會覆蓋既有資料，若要改成 Excel 的值請於匯入後手動修改。`
          : null;

      // V29 A：對「配對到既有成員」者，逐欄比對 Excel(person 嚴格) vs DB 現值。
      // matchSafe＝SKIP_SAME_PERSON（家戶編號＋姓名唯一）；其餘（REVIEW/跨戶/多候選）一律待確認。
      const matchedMemberId = matchedExisting?.id ?? null;
      let fieldDiffs: FieldDiff[] | undefined;
      let rowCategory: RowCategory | undefined;
      if (matchedMemberId && person) {
        const dbFull = existingFullById.get(matchedMemberId);
        if (dbFull) {
          const excelSide: ExcelSideValues = {
            gender: person.gender,
            solarBirthDate: person.solarBirthDate,
            lunarBirthYear: person.lunarBirthYear,
            lunarBirthMonth: person.lunarBirthMonth,
            lunarBirthDay: person.lunarBirthDay,
            lunarIsLeapMonth: person.lunarIsLeapMonth,
            nationalId: person.nationalId,
            address: person.address, // V29：只取個人通訊地址，不吃家戶遞補
            role: person.role,
            mobile: person.mobile,
            email: person.email,
          };
          const dbSide: DbSideValues = {
            gender: dbFull.gender,
            solarBirthDate: dbFull.solarBirthDate ? toCalendarDateKey(dbFull.solarBirthDate) : null,
            lunarBirthYear: dbFull.lunarBirthYear,
            lunarBirthMonth: dbFull.lunarBirthMonth,
            lunarBirthDay: dbFull.lunarBirthDay,
            lunarIsLeapMonth: dbFull.lunarIsLeapMonth,
            nationalId: dbFull.nationalId,
            address: dbFull.address,
            role: dbFull.role,
            mobile: dbFull.mobile,
            email: dbFull.email,
          };
          fieldDiffs = computeFieldDiffs(excelSide, dbSide);
          rowCategory = classifyRow(result.suggestion === "SKIP_SAME_PERSON", fieldDiffs);
        }
      }

      return {
        name,
        action,
        confidence: result.candidates[0]?.confidence ?? null,
        reason: result.reason,
        candidates: result.candidates,
        personData: person ? incoming : null,
        genderConflict,
        matchedMemberId,
        fieldDiffs,
        rowCategory,
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
      // V13.1：牌位地址在預檢階段算好一起落地（commit 時已無個人 Excel）
      rawData: serializeRowForStorage(
        normalized,
        plan,
        buildTabletLocations(normalized, personLookup),
        buildTabletYangshang(normalized)
      ) as unknown as Prisma.InputJsonValue,
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
      tabletLocations: buildTabletLocations(normalized, personLookup),
      tabletYangshang: buildTabletYangshang(normalized),
    };
  });

  return {
    batchId: batch.id,
    summary,
    rows,
    sheetPreparation: correctionOnly
      ? { excelRowCount: personRawRows?.length ?? 0, householdRowCount: normalizedRows.length, mergedRowCount: 0 }
      : {
          excelRowCount: rawRows.length,
          householdRowCount: normalizedRows.length,
          mergedRowCount: Math.max(0, rawRows.length - normalizedRows.length),
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
      // 舊批次沒有 tabletLocations，一律容忍為 null（牌位地址視為待補）
      tabletLocations: stored.tabletLocations ?? null,
      // 舊批次沒有 tabletYangshang，一律容忍為 null（無陽上，不覆蓋）
      tabletYangshang: stored.tabletYangshang ?? null,
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

  /**
   * V24.2 效能根因修正：確認匯入頁「永久載入中」。
   *
   * 舊做法對每一戶各發 2 次查詢（member.findMany + worshipRecord.findMany），
   * 727 戶＝約 1,454 次**連續**查詢，實測 commit-preview 回應要 114–157 秒，
   * 前端等同永久卡在「載入中」。回傳內容其實只有幾個統計數字（payload 很小），
   * 慢的是資料庫來回次數，不是資料量。
   *
   * 改為「三次批次查詢」：一次撈回全部相關的既有家戶／成員／牌位，於記憶體
   * 依家戶編號分組後比對。查詢邏輯與結果完全不變，只是把 O(戶數) 次來回
   * 壓成固定 3 次，數百戶也能在極短時間內回應。
   */
  const [existingHouseholds, existingMembers, existingWorship] = await Promise.all([
    prisma.household.findMany({ where: { id: { in: codes }, deletedAt: null }, select: { id: true } }),
    prisma.member.findMany({
      where: { householdId: { in: codes }, deletedAt: null },
      select: { householdId: true, name: true },
    }),
    prisma.worshipRecord.findMany({
      where: { householdId: { in: codes }, deletedAt: null },
      select: { householdId: true, type: true, displayName: true },
    }),
  ]);

  const existingHouseholdIds = new Set(existingHouseholds.map((h) => h.id));
  const newHouseholdCount = codes.filter((c) => !existingHouseholdIds.has(c)).length;
  const updateHouseholdCount = codes.length - newHouseholdCount;

  // 依家戶編號把既有成員／牌位名稱分組（記憶體內），對應舊做法逐戶查詢的結果。
  const existingMemberNamesByCode = new Map<string, Set<string>>();
  for (const m of existingMembers) {
    let set = existingMemberNamesByCode.get(m.householdId);
    if (!set) existingMemberNamesByCode.set(m.householdId, (set = new Set()));
    set.add(m.name);
  }
  const existingAncestorNamesByCode = new Map<string, Set<string>>();
  const existingSpiritNamesByCode = new Map<string, Set<string>>();
  for (const w of existingWorship) {
    const target =
      w.type === "ANCESTOR_LINE"
        ? existingAncestorNamesByCode
        : w.type === "INDIVIDUAL"
          ? existingSpiritNamesByCode
          : null;
    if (!target) continue;
    let set = target.get(w.householdId);
    if (!set) target.set(w.householdId, (set = new Set()));
    set.add(w.displayName);
  }

  const EMPTY_NAME_SET: ReadonlySet<string> = new Set();
  let newMemberCount = 0;
  let newAncestorCount = 0;
  let newSpiritCount = 0;

  for (const [code, bucket] of namesByCode) {
    const existingMemberNames = existingMemberNamesByCode.get(code) ?? EMPTY_NAME_SET;
    const existingAncestorNames = existingAncestorNamesByCode.get(code) ?? EMPTY_NAME_SET;
    const existingSpiritNames = existingSpiritNamesByCode.get(code) ?? EMPTY_NAME_SET;

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
  options: { chunkSize?: number; corrections?: MemberCorrectionInput[]; correctionOnly?: boolean } = {}
): Promise<CommitDevoteeImportResult> {
  const chunkSize = Math.max(1, options.chunkSize ?? DEFAULT_COMMIT_CHUNK_SIZE);
  // V29 校正模式：略過所有 Household 建立/更新與 Member 新增，只套用使用者勾選的欄位校正。
  const correctionOnly = options.correctionOnly === true;
  // V29 B：使用者勾選的欄位校正（rowId::memberName → {mode, selectedFields}）。空＝維持既有只補空白。
  const correctionMap = new Map<string, MemberCorrectionInput>();
  for (const c of options.corrections ?? []) correctionMap.set(`${c.rowId}::${c.memberName}`, c);

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

      /**
       * V24.3 交易逾時根因修正：把「逐戶逐筆 create + 每筆 recordVersion」改成
       * 「批次預查 + createMany 批次寫入 + 單次 recordVersion.createMany」。
       *
       * 舊做法每戶約 17 次連續查詢，遠端資料庫單次往返約 150ms，一批 50 戶＝
       * 850+ 次往返、實測 126 秒，超過互動式交易上限，之後的 member.create 落在
       * 已關閉的交易上 → "Transaction not found"。新做法把「讀」壓成 4 次批次預查、
       * 「寫」壓成每種資料一次 createMany（家戶／成員／個資／牌位／稽核），業務規則
       * 與稽核內容不變，整批仍在單一交易內（整批成功或整批回滾）。罕見路徑（個人檔
       * 補欄位 UPDATE、人工確認轉戶 TRANSFER_IN、既有家戶更新）數量極少，維持原逐筆
       * 邏輯，於批次寫入後執行。
       */
      const codes = readyRows.map((r) => r.household.code);

      // ── 批次預查：一次撈回本批相關的既有家戶／別名／封存／成員名／牌位名 ──
      const [existingActive, archivedRows, aliasRows, existingMembersRows, existingWorshipRows] =
        await Promise.all([
          tx.household.findMany({ where: { id: { in: codes }, deletedAt: null } }),
          tx.household.findMany({ where: { id: { in: codes }, NOT: { deletedAt: null } }, select: { id: true, name: true } }),
          tx.householdCodeAlias.findMany({ where: { oldCode: { in: codes } }, include: { household: true } }),
          tx.member.findMany({ where: { householdId: { in: codes }, deletedAt: null }, select: { id: true, name: true, householdId: true } }),
          tx.worshipRecord.findMany({ where: { householdId: { in: codes }, deletedAt: null }, select: { householdId: true, type: true, displayName: true } }),
        ]);
      const activeByCode = new Map(existingActive.map((h) => [h.id, h]));
      const archivedByCode = new Map(archivedRows.map((h) => [h.id, h]));
      const aliasByOldCode = new Map(aliasRows.map((a) => [a.oldCode, a]));
      const existingMemberNamesByHousehold = new Map<string, Set<string>>();
      for (const m of existingMembersRows) {
        let s = existingMemberNamesByHousehold.get(m.householdId);
        if (!s) existingMemberNamesByHousehold.set(m.householdId, (s = new Set()));
        s.add(m.name);
      }
      const worshipNamesByHousehold = new Map<string, { ancestors: Set<string>; spirits: Set<string> }>();
      for (const w of existingWorshipRows) {
        let e = worshipNamesByHousehold.get(w.householdId);
        if (!e) worshipNamesByHousehold.set(w.householdId, (e = { ancestors: new Set(), spirits: new Set() }));
        if (w.type === "ANCESTOR_LINE") e.ancestors.add(w.displayName);
        else if (w.type === "INDIVIDUAL") e.spirits.add(w.displayName);
      }

      // ── 累積器（記憶體內完成分類，最後批次寫入） ──
      const auditRows: Prisma.RecordVersionCreateManyInput[] = [];
      const pushAudit = (input: {
        entityType: string;
        entityId: string;
        action: "CREATE" | "UPDATE";
        beforeData?: unknown;
        afterData?: unknown;
        changeNote?: string | null;
      }) => {
        const rowData: Prisma.RecordVersionCreateManyInput = {
          entityType: input.entityType,
          entityId: input.entityId,
          action: input.action,
          operatorName: operatorName?.trim() || null,
          changeNote: input.changeNote?.trim() || null,
        };
        if (input.beforeData !== undefined) rowData.beforeData = toJsonSnapshot(input.beforeData);
        if (input.afterData !== undefined) rowData.afterData = toJsonSnapshot(input.afterData);
        auditRows.push(rowData);
      };

      const householdCreateData: Prisma.HouseholdCreateManyInput[] = [];
      const newHouseholdCodes: string[] = [];
      const householdUpdateOps: { id: string; data: Prisma.HouseholdUpdateInput; before: unknown; changeNote: string }[] = [];
      const memberCreateData: Prisma.MemberCreateManyInput[] = [];
      const newMemberMeta: { id: string; householdId: string; name: string; changeNote: string; mobile: string | null }[] = [];
      const worshipCreateData: Prisma.WorshipRecordCreateManyInput[] = [];
      const newWorshipIds: string[] = [];
      const worshipAuditNote = new Map<string, string>();
      const resolvedHouseholdIdByRowId = new Map<string, string>();
      const newHouseholdIds = new Set<string>();

      // ── 第一輪：記憶體分類（Household 解析、成員／牌位分類），不寫入 ──
      for (const r of readyRows) {
        const code = r.household.code;
        const active = activeByCode.get(code);
        const alias = active ? undefined : aliasByOldCode.get(code);
        const aliasHousehold = alias?.household && !alias.household.deletedAt ? alias.household : undefined;

        let householdId: string;
        if (active || aliasHousehold) {
          // 既有家戶（含舊編號別名）→ 更新基本資料（空白不覆蓋，除非明確覆蓋）。
          const before = (active ?? aliasHousehold)!;
          householdId = before.id;
          const overwriteBlanks = r.plan?.overwriteBlanks === true;
          const keepIfBlank = <T,>(excel: T | null, existing: T | null): T | null =>
            excel !== null && excel !== undefined && excel !== ("" as unknown as T)
              ? excel
              : overwriteBlanks
                ? excel ?? null
                : existing;
          householdUpdateOps.push({
            id: householdId,
            data: {
              name: r.household.name || (overwriteBlanks ? r.household.name : before.name),
              contactName: keepIfBlank(r.household.contactName, before.contactName),
              address: keepIfBlank(r.household.address, before.address),
            },
            before,
            changeNote: aliasHousehold
              ? `信眾資料匯入預檢中心：正式匯入（Excel 使用舊家戶編號 ${code}，已對照到目前家戶 ${householdId}，更新基本資料）`
              : "信眾資料匯入預檢中心：正式匯入（家戶編號已存在，更新基本資料）",
          });
          householdsUpdated++;
        } else {
          // 全新家戶；但若編號屬於「已封存、無別名」→ 直接 create 會撞主鍵，明確擋下並整批回滾。
          const archived = archivedByCode.get(code);
          if (archived) {
            throw new Error(
              `家戶編號 ${code} 屬於已封存的家戶「${archived.name}」，既沒有合併也沒有編號對照。` +
                `請先從回收區恢復該家戶、或改用其他編號、或把這一列從本次匯入中排除，再重新執行匯入。`
            );
          }
          householdId = code;
          newHouseholdIds.add(code);
          newHouseholdCodes.push(code);
          householdCreateData.push({
            id: code,
            name: r.household.name,
            contactName: r.household.contactName,
            address: r.household.address,
          });
          householdsCreated++;
        }
        touchedHouseholdIds.add(householdId);
        resolvedHouseholdIdByRowId.set(r.id, householdId);
        importedRowIds.push(r.id);

        // 家戶成員：依 plan 分類。CREATE／CREATE_NEW（＝一般新增）進批次；UPDATE／TRANSFER_IN 留待第二輪逐筆。
        const plannedMembers = r.plan?.members;
        if (plannedMembers?.length) {
          for (const pm of plannedMembers) {
            if (pm.action === "SKIP") continue;
            if (pm.action === "REVIEW") {
              const res = pm.resolution;
              if (!res) continue;
              // KEEP_ORIGINAL／SKIP：不動；TRANSFER_IN：第二輪處理；CREATE_NEW：維持原行為（原程式此處不落入 create 分支）。
              continue;
            }
            if (pm.action === "UPDATE") continue; // 第二輪逐筆處理
            if (pm.action === "CREATE") {
              if (correctionOnly) continue; // V29 校正模式不新增任何 Member（Excel 有、DB 無 只顯示不建立）
              // plan 已判定為新增（多欄比對認定為不同人），一律建立，不再依姓名去重。
              const id = randomUUID();
              const solar = toSafeCalendarDate(pm.personData?.solarBirthDate ?? null);
              memberCreateData.push({
                id,
                householdId,
                name: pm.name,
                ...(solar ? { solarBirthDate: solar } : {}),
                ...(pm.personData?.gender ? { gender: pm.personData.gender } : {}),
                ...(pm.personData?.role ? { role: pm.personData.role as Prisma.MemberCreateManyInput["role"] } : {}),
                ...(pm.personData?.nationalId ? { nationalId: pm.personData.nationalId } : {}),
                // V25：正式信眾 Excel 的「通訊地址」→ Member.address（個人地址，最高權威）。
                // 家戶匯入永遠不寫 Member.address；同戶不同成員可各有不同個人地址。
                // cast 以相容尚未 regenerate 的 Prisma client。
                ...(pm.personData?.address ? ({ address: pm.personData.address } as Record<string, unknown>) : {}),
                ...(pm.personData?.lunarBirthYear
                  ? {
                      lunarBirthYear: pm.personData.lunarBirthYear,
                      lunarBirthMonth: pm.personData.lunarBirthMonth,
                      lunarBirthDay: pm.personData.lunarBirthDay,
                      lunarIsLeapMonth: pm.personData.lunarIsLeapMonth,
                    }
                  : {}),
              });
              newMemberMeta.push({
                id,
                householdId,
                name: pm.name,
                changeNote: `信眾資料匯入預檢中心：正式匯入（家戶成員）${pm.personData ? "｜已套用個人資料 Excel 補充欄位" : ""}`,
                mobile: pm.personData?.mobile ?? null,
              });
              membersCreated++;
            }
          }
        } else if (r.memberNames.length > 0) {
          // 向下相容：舊批次（rawData 沒有 plan）→ 依姓名比對，已存在的略過。
          const seedNames = new Set(existingMemberNamesByHousehold.get(householdId) ?? []);
          for (const memberName of r.memberNames) {
            if (seedNames.has(memberName)) continue;
            seedNames.add(memberName);
            const id = randomUUID();
            memberCreateData.push({ id, householdId, name: memberName });
            newMemberMeta.push({ id, householdId, name: memberName, changeNote: "信眾資料匯入預檢中心：正式匯入（家戶成員）", mobile: null });
            membersCreated++;
          }
        }

        // 牌位：歷代祖先／乙位正魂。依名稱比對，已存在（含本批稍早同戶）的略過，其餘進批次。
        const tabletLocation = (name: string): string | null => r.tabletLocations?.[name] ?? null;
        const tabletYangshang = (name: string): string | null => r.tabletYangshang?.[name] ?? null;
        let wseed = worshipNamesByHousehold.get(householdId);
        if (!wseed) worshipNamesByHousehold.set(householdId, (wseed = { ancestors: new Set(), spirits: new Set() }));
        for (const displayName of r.ancestorNames) {
          if (wseed.ancestors.has(displayName)) continue;
          wseed.ancestors.add(displayName);
          const id = randomUUID();
          worshipCreateData.push({
            id,
            householdId,
            type: "ANCESTOR_LINE",
            displayName,
            location: tabletLocation(displayName),
            yangshangName: tabletYangshang(displayName),
            createdByName: operatorName ?? null,
          });
          newWorshipIds.push(id);
          worshipAuditNote.set(id, "信眾資料匯入預檢中心：正式匯入（歷代祖先）");
          ancestorsCreated++;
        }
        for (const displayName of r.spiritNames) {
          if (wseed.spirits.has(displayName)) continue;
          wseed.spirits.add(displayName);
          const id = randomUUID();
          worshipCreateData.push({
            id,
            householdId,
            type: "INDIVIDUAL",
            displayName,
            location: tabletLocation(displayName),
            yangshangName: tabletYangshang(displayName),
            createdByName: operatorName ?? null,
          });
          newWorshipIds.push(id);
          worshipAuditNote.set(id, "信眾資料匯入預檢中心：正式匯入（乙位正魂）");
          spiritsCreated++;
        }
      }

      // ── 第二輪：批次寫入（順序：Household → Member → DevoteeProfile → WorshipRecord），維持 FK 依賴 ──
      // V29 校正模式：完全略過 Household 的建立與更新（只做成員欄位校正）。
      if (!correctionOnly && householdCreateData.length > 0) {
        await tx.household.createMany({ data: householdCreateData });
        const createdHouseholds = await tx.household.findMany({ where: { id: { in: newHouseholdCodes } } });
        for (const h of createdHouseholds) {
          pushAudit({ entityType: "Household", entityId: h.id, action: "CREATE", afterData: h, changeNote: "信眾資料匯入預檢中心：正式匯入" });
        }
      }
      if (!correctionOnly) {
        for (const op of householdUpdateOps) {
          const after = await tx.household.update({ where: { id: op.id }, data: op.data });
          pushAudit({ entityType: "Household", entityId: op.id, action: "UPDATE", beforeData: op.before, afterData: after, changeNote: op.changeNote });
        }
      }

      if (!correctionOnly && memberCreateData.length > 0) {
        await tx.member.createMany({ data: memberCreateData });
        const createdMembers = await tx.member.findMany({ where: { id: { in: newMemberMeta.map((m) => m.id) } } });
        const createdById = new Map(createdMembers.map((m) => [m.id, m]));
        for (const meta of newMemberMeta) {
          const row = createdById.get(meta.id);
          if (row) pushAudit({ entityType: "Member", entityId: meta.id, action: "CREATE", afterData: row, changeNote: meta.changeNote });
        }
        const profileData = newMemberMeta
          .filter((m) => m.mobile)
          .map((m) => ({ memberId: m.id, mobile: m.mobile! }));
        if (profileData.length > 0) await tx.devoteeProfile.createMany({ data: profileData });
      }

      if (worshipCreateData.length > 0) {
        await tx.worshipRecord.createMany({ data: worshipCreateData });
        const createdWorship = await tx.worshipRecord.findMany({ where: { id: { in: newWorshipIds } } });
        for (const w of createdWorship) {
          pushAudit({ entityType: "WorshipRecord", entityId: w.id, action: "CREATE", afterData: w, changeNote: worshipAuditNote.get(w.id) ?? "信眾資料匯入預檢中心：正式匯入（牌位）" });
        }
      }

      // ── 罕見路徑（逐筆，數量極少）：UPDATE 以個人檔補空欄位、REVIEW/TRANSFER_IN 轉戶 ──
      for (const r of readyRows) {
        const plannedMembers = r.plan?.members;
        if (!plannedMembers?.length) continue;
        const householdId = resolvedHouseholdIdByRowId.get(r.id)!;
        for (const pm of plannedMembers) {
          if (pm.action === "REVIEW" && pm.resolution?.decision === "TRANSFER_IN" && pm.resolution.memberId) {
            const moving = await tx.member.findUnique({ where: { id: pm.resolution.memberId } });
            if (!moving || moving.deletedAt) continue;
            if (moving.householdId === householdId) continue;
            const before = moving;
            const after = await tx.member.update({ where: { id: pm.resolution.memberId }, data: { householdId } });
            const syncCounts = await syncMemberHouseholdReferences(tx, [pm.resolution.memberId], householdId);
            pushAudit({
              entityType: "Member",
              entityId: pm.resolution.memberId,
              action: "UPDATE",
              beforeData: before,
              afterData: after,
              changeNote: `信眾資料匯入預檢中心：依人工確認，由家戶 ${before.householdId} 轉入 ${householdId}｜同步關聯紀錄：${describeSyncCounts(syncCounts)}`,
            });
            membersUpdated++;
            continue;
          }
          if (pm.action === "UPDATE") {
            const targetId = pm.candidates[0]?.memberId;
            if (!targetId || !pm.personData) continue;
            // V29 交易保護：更新前再次驗證 memberId 仍存在、且家戶關聯未變（分析後被搬戶則不動）。
            const existing = await tx.member.findUnique({ where: { id: targetId } });
            if (!existing) continue;
            const expectedHouseholdId = pm.candidates[0]?.householdId ?? null;
            if (expectedHouseholdId && existing.householdId !== expectedHouseholdId) continue;

            const patch: Prisma.MemberUpdateInput = {};
            const profilePatch: { mobile?: string; email?: string } = {};

            const correction = correctionMap.get(`${r.id}::${pm.name}`);
            if (correction !== undefined) {
              // ── V29 校正模式：只寫使用者勾選、且依模式/安全規則可寫的欄位。 ──
              const mode: CorrectionMode = correction.correctionMode ?? "FILL_BLANK_ONLY";
              const writable = buildSelectedCorrections(pm.fieldDiffs ?? [], new Set(correction.selectedFields), mode);
              for (const f of writable) {
                if (isProfileField(f)) {
                  if (f === "mobile" && pm.personData.mobile) profilePatch.mobile = pm.personData.mobile;
                  if (f === "email" && pm.personData.email) profilePatch.email = pm.personData.email;
                  continue;
                }
                if (f === "gender" && pm.personData.gender) patch.gender = pm.personData.gender;
                else if (f === "solarBirthDate") {
                  const s = toSafeCalendarDate(pm.personData.solarBirthDate ?? null);
                  if (s) patch.solarBirthDate = s;
                } else if (f === "lunarBirth" && pm.personData.lunarBirthYear) {
                  patch.lunarBirthYear = pm.personData.lunarBirthYear;
                  patch.lunarBirthMonth = pm.personData.lunarBirthMonth;
                  patch.lunarBirthDay = pm.personData.lunarBirthDay;
                  patch.lunarIsLeapMonth = pm.personData.lunarIsLeapMonth;
                } else if (f === "nationalId" && pm.personData.nationalId) patch.nationalId = pm.personData.nationalId;
                else if (f === "address" && pm.personData.address) (patch as Record<string, unknown>).address = pm.personData.address;
                else if (f === "role" && pm.personData.role) patch.role = pm.personData.role as Prisma.MemberUpdateInput["role"];
              }
            } else {
              // ── 既有相容：一般匯入（未使用校正 UI）維持「只補空白、不覆蓋」自動行為。 ──
              const safeSolar = toSafeCalendarDate(pm.personData.solarBirthDate ?? null);
              if (!existing.solarBirthDate && safeSolar) patch.solarBirthDate = safeSolar;
              if (!existing.lunarBirthYear && pm.personData.lunarBirthYear) {
                patch.lunarBirthYear = pm.personData.lunarBirthYear;
                patch.lunarBirthMonth = pm.personData.lunarBirthMonth;
                patch.lunarBirthDay = pm.personData.lunarBirthDay;
                patch.lunarIsLeapMonth = pm.personData.lunarIsLeapMonth;
              }
              if (!existing.nationalId && pm.personData.nationalId) patch.nationalId = pm.personData.nationalId;
              if (!existing.gender && pm.personData.gender) patch.gender = pm.personData.gender;
              if (!(existing as unknown as { address: string | null }).address && pm.personData.address) {
                (patch as Record<string, unknown>).address = pm.personData.address;
              }
              if (existing.role === "OTHER" && pm.personData.role && pm.personData.role !== "OTHER") {
                patch.role = pm.personData.role as Prisma.MemberUpdateInput["role"];
              }
              if (pm.personData.mobile) {
                const profile = await tx.devoteeProfile.findUnique({ where: { memberId: targetId } });
                if (!profile || !profile.mobile) profilePatch.mobile = pm.personData.mobile;
              }
            }

            if (Object.keys(patch).length > 0) {
              const after = await tx.member.update({ where: { id: targetId }, data: patch });
              pushAudit({
                entityType: "Member",
                entityId: targetId,
                action: "UPDATE",
                beforeData: existing,
                afterData: after,
                changeNote:
                  correction !== undefined
                    ? `信眾資料匯入預檢中心：欄位校正（模式：${correction.correctionMode === "CORRECT_WITH_EXCEL" ? "以Excel校正錯值" : "只補空白"}；更新欄位：${Object.keys(patch).join("、")}；比對依據：${pm.candidates[0]?.matchedFields.join("＋") ?? "姓名"}）`
                    : `信眾資料匯入預檢中心：正式匯入（以個人資料 Excel 補足空白欄位，比對依據：${pm.candidates[0]?.matchedFields.join("＋") ?? "姓名"}）`,
              });
              membersUpdated++;
            }
            // DevoteeProfile（手機/Email）：只補空白或校正（依上面決定），create/update。
            if (profilePatch.mobile !== undefined || profilePatch.email !== undefined) {
              const profile = await tx.devoteeProfile.findUnique({ where: { memberId: targetId } });
              if (!profile) {
                await tx.devoteeProfile.create({ data: { memberId: targetId, ...profilePatch } });
                membersUpdated++;
              } else {
                const beforeProfile = { mobile: profile.mobile, email: profile.email };
                const afterProfile = await tx.devoteeProfile.update({ where: { memberId: targetId }, data: profilePatch });
                pushAudit({
                  entityType: "Member",
                  entityId: targetId,
                  action: "UPDATE",
                  beforeData: beforeProfile,
                  afterData: { mobile: afterProfile.mobile, email: afterProfile.email },
                  changeNote: `信眾資料匯入預檢中心：DevoteeProfile 校正（${Object.keys(profilePatch).join("、")}）`,
                });
                membersUpdated++;
              }
            }
          }
        }
      }

      // ── 稽核：一次寫入本批所有版本紀錄（原本每筆一次 insert，現為單次 createMany） ──
      if (auditRows.length > 0) await tx.recordVersion.createMany({ data: auditRows });

      /**
       * V12.6 指令七：主要聯絡人一致性同步（呼叫既有 setPrimaryContact，不複製邏輯）。
       * 全新家戶為效能考量批次處理（新戶必無其他主要聯絡人、contactName 於建立時已寫入，
       * 只需把對應成員 isPrimaryContact 設為 true）；既有家戶維持原逐筆邏輯（數量極少）。
       */
      const newPrimaryMemberIds: string[] = [];
      for (const r of readyRows) {
        const householdId = resolvedHouseholdIdByRowId.get(r.id)!;
        if (!newHouseholdIds.has(householdId)) continue;
        const contactName = r.household.contactName;
        if (!contactName) continue;
        const match = newMemberMeta.find((m) => m.householdId === householdId && m.name === contactName);
        if (match) newPrimaryMemberIds.push(match.id);
      }
      if (newPrimaryMemberIds.length > 0) {
        await tx.member.updateMany({ where: { id: { in: newPrimaryMemberIds } }, data: { isPrimaryContact: true } });
      }
      for (const householdId of touchedHouseholdIds) {
        if (newHouseholdIds.has(householdId)) continue; // 新戶已於上方批次處理
        const h = await tx.household.findUnique({ where: { id: householdId }, select: { contactName: true } });
        if (!h?.contactName) continue;
        const matched = await tx.member.findFirst({ where: { householdId, name: h.contactName, deletedAt: null }, select: { id: true } });
        if (matched) await setPrimaryContact(tx, householdId, matched.id);
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
