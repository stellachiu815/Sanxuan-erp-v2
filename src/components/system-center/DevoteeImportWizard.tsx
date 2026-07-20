"use client";

import { useState } from "react";
import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";

/**
 * V11.3「信眾資料匯入預檢中心」正式版——五步驟精靈（依正式 7 欄 Excel 格式）：
 *   ① 上傳檔案 → ② 欄位對照 → ③ 預覽與統計 → ④ 確認匯入 → ⑤ 匯入結果
 *
 * V12.6「Excel 匯入中心正式版」更新：
 *
 * 「家戶」層級仍然沒有模糊地帶——一列＝一戶、家戶編號是唯一鍵（含舊編號
 * 對照），要新增還是更新在預檢當下就能百分之百決定。
 *
 * 但「家戶成員」層級有：V12.6 起成員改用多欄比對（姓名＋手機／市話／生日／
 * 地址），而且會跨家戶偵測同名的人。以下兩種情況無法由系統自行決定，一律
 * 標成 SUSPECTED_DUPLICATE、**預設不匯入**，在第三步逐列顯示原因與可選的
 * 處理方式，由行政人員判斷：
 *
 *   1. 同名但證據不足（沒有手機也沒有生日可以佐證）
 *   2. 同名的人已經存在於別的家戶（指令三：不可自動轉戶）
 *
 * 第二份「個人資料 Excel」（選填）就是用來降低第 1 種情況的——有手機或
 * 生日可比對時，系統才能給出高可信度判斷。
 */

type ClientHouseholdFields = {
  code: string;
  name: string;
  contactName: string | null;
  address: string | null;
};

type RowStatus =
  | "READY_TO_IMPORT"
  | "INCOMPLETE_DATA"
  | "FORMAT_ERROR"
  | "EXCLUDED"
  | "IMPORTED"
  // V12.6：成員層級多欄比對後需要人工確認的列
  | "SUSPECTED_DUPLICATE"
  | "HOUSEHOLD_UNCERTAIN";

/** V12.6 指令六：每一列的預計動作（由後端預檢算好，畫面只負責顯示）。 */
type MatchCandidate = {
  memberId: string;
  name: string;
  householdId: string;
  householdName: string;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  matchedFields: string[];
  inOtherHousehold: boolean;
};

type PlannedMember = {
  name: string;
  action: "CREATE" | "UPDATE" | "REVIEW" | "SKIP";
  confidence: "HIGH" | "MEDIUM" | "LOW" | null;
  reason: string;
  candidates: MatchCandidate[];
  personData: unknown | null;
  resolution?: {
    decision: "KEEP_ORIGINAL" | "TRANSFER_IN" | "CREATE_NEW" | "SKIP";
    memberId: string | null;
    householdId: string | null;
  } | null;
};

type RowPlan = {
  rowNumber: number;
  householdAction: "CREATE" | "UPDATE" | "BLOCKED";
  matchedHouseholdId: string | null;
  matchedViaAlias: boolean;
  existingHousehold: { name: string; contactName: string | null; address: string | null } | null;
  fieldConflicts: { field: string; excelValue: string; existingValue: string }[];
  keptExistingFields: string[];
  members: PlannedMember[];
  blockedReason: string | null;
};

type AnalyzedRow = {
  id: string;
  rowNumber: number;
  household: ClientHouseholdFields;
  memberNames: string[];
  ancestorNames: string[];
  spiritNames: string[];
  status: RowStatus;
  errors: string[];
  warnings: string[];
  plan: RowPlan | null;
};

type Summary = {
  total: number;
  readyToImport: number;
  incompleteData: number;
  formatError: number;
  excluded: number;
  imported: number;
  // V12.6 指令六：預檢分類
  suspectedDuplicate: number;
  householdUncertain: number;
  householdsToCreate: number;
  householdsToUpdate: number;
  membersToCreate: number;
  membersToUpdate: number;
  autoMatchedHighConfidence: number;
  fieldConflicts: number;
};

type TargetField = { key: string; label: string; required?: boolean };

type CommitPreview = {
  newHouseholdCount: number;
  updateHouseholdCount: number;
  newMemberCount: number;
  newAncestorCount: number;
  newSpiritCount: number;
  skippedCount: number;
  /** V12.6 驗收修正：尚未完成人工確認的成員數 */
  pendingResolutions: number;
  overCap: boolean;
  capMessage: string | null;
};

type CommitResult = {
  householdsCreated: number;
  householdsUpdated: number;
  membersCreated: number;
  /** V12.6：以個人資料 Excel 補足既有信眾空白欄位的筆數 */
  membersUpdated?: number;
  ancestorsCreated: number;
  spiritsCreated: number;
  skippedCount: number;
  failedCount: number;
  failures: { rowNumber: number; householdName: string | null; error: string }[];
  committedAt: string;
};

const STEP_LABELS = ["上傳檔案", "欄位對照", "預覽與統計", "確認匯入", "匯入結果"];

const STATUS_LABEL: Record<RowStatus, string> = {
  READY_TO_IMPORT: "可匯入",
  INCOMPLETE_DATA: "資料不完整",
  FORMAT_ERROR: "格式錯誤",
  EXCLUDED: "不匯入",
  IMPORTED: "已匯入",
  SUSPECTED_DUPLICATE: "疑似重複（需人工確認）",
  HOUSEHOLD_UNCERTAIN: "待確認家戶",
};

// ⚠️ 顏色僅使用 tailwind.config.ts 實際定義的色階（yolk/blossom/mist/sage
// 只到 300，ink 只有 DEFAULT/soft/faint，沒有數字色階）。
const STATUS_BADGE_CLASS: Record<RowStatus, string> = {
  READY_TO_IMPORT: "bg-sage-200 text-ink",
  INCOMPLETE_DATA: "bg-blossom-200 text-ink",
  FORMAT_ERROR: "bg-blossom-200 text-ink",
  EXCLUDED: "bg-cream-200 text-ink-faint",
  IMPORTED: "bg-sage-200 text-ink",
  SUSPECTED_DUPLICATE: "bg-yolk-200 text-ink",
  HOUSEHOLD_UNCERTAIN: "bg-yolk-200 text-ink",
};

/**
 * V12.6 驗收修正（指令一）：分類篩選。
 *
 * 每個分類都是可點的按鈕，點下去只顯示該分類的**完整**清單（可分頁載入
 * 更多），不再是「只看得到前 20 筆、其餘無法查看」。
 */
type FilterKey =
  | "ALL"
  | "SUSPECTED_DUPLICATE"
  | "FIELD_CONFLICT"
  | "INCOMPLETE_DATA"
  | "FORMAT_ERROR"
  | "HOUSEHOLD_CREATE"
  | "HOUSEHOLD_UPDATE"
  | "MEMBER_CREATE"
  | "MEMBER_UPDATE"
  | "EXCLUDED";

function matchesFilter(r: AnalyzedRow, key: FilterKey): boolean {
  switch (key) {
    case "ALL":
      return true;
    case "SUSPECTED_DUPLICATE":
      return r.status === "SUSPECTED_DUPLICATE";
    case "FIELD_CONFLICT":
      return (r.plan?.fieldConflicts.length ?? 0) > 0;
    case "INCOMPLETE_DATA":
      return r.status === "INCOMPLETE_DATA";
    case "FORMAT_ERROR":
      return r.status === "FORMAT_ERROR";
    case "HOUSEHOLD_CREATE":
      return r.plan?.householdAction === "CREATE";
    case "HOUSEHOLD_UPDATE":
      return r.plan?.householdAction === "UPDATE";
    case "MEMBER_CREATE":
      return (r.plan?.members.some((m) => m.action === "CREATE") ?? false);
    case "MEMBER_UPDATE":
      return (r.plan?.members.some((m) => m.action === "UPDATE") ?? false);
    case "EXCLUDED":
      return r.status === "EXCLUDED";
    default:
      return true;
  }
}

const FILTER_LABEL: Record<FilterKey, string> = {
  ALL: "全部",
  SUSPECTED_DUPLICATE: "疑似重複",
  FIELD_CONFLICT: "欄位衝突",
  INCOMPLETE_DATA: "必填缺漏",
  FORMAT_ERROR: "格式錯誤",
  HOUSEHOLD_CREATE: "可新增家戶",
  HOUSEHOLD_UPDATE: "可更新家戶",
  MEMBER_CREATE: "可新增信眾",
  MEMBER_UPDATE: "可更新信眾",
  EXCLUDED: "已略過",
};

const dash = (v: string | null | undefined): string => (v && v.trim().length > 0 ? v : "—");

export default function DevoteeImportWizard() {
  const { operatorUserId, operatorUser } = useOperator();

  const [step, setStep] = useState(1);

  // ---- 檔案（保留在瀏覽器記憶體，欄位對照調整後可以重新分析同一個檔案，不用重新上傳） ----
  const [file, setFile] = useState<File | null>(null);
  /** V12.6 指令四：可選的第二份「個人資料 Excel」，用來補足成員欄位。 */
  const [personFile, setPersonFile] = useState<File | null>(null);
  const [personInfo, setPersonInfo] = useState<{ fileName: string | null; rowCount: number } | null>(null);
  /** V12.8：合併儲存格前處理結果（Excel 列數 → 家戶數） */
  const [sheetPrep, setSheetPrep] = useState<{
    excelRowCount: number;
    householdRowCount: number;
    mergedRowCount: number;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  // ---- 分析結果 ----
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [targetFields, setTargetFields] = useState<TargetField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [summary, setSummary] = useState<Summary | null>(null);
  const [rows, setRows] = useState<AnalyzedRow[]>([]);

  // ---- V12.6 驗收修正：分類篩選與分頁 ----
  const [filterKey, setFilterKey] = useState<FilterKey>("ALL");
  const [visibleCount, setVisibleCount] = useState(20);
  /** 整批尚未完成人工確認的成員數（>0 時停用正式匯入） */
  const [pendingTotal, setPendingTotal] = useState(0);
  const [savingResolution, setSavingResolution] = useState<string | null>(null);
  const [resolutionError, setResolutionError] = useState<string | null>(null);

  // ---- 確認匯入 ----
  const [commitPreview, setCommitPreview] = useState<CommitPreview | null>(null);
  const [commitPreviewError, setCommitPreviewError] = useState<string | null>(null);
  const [loadingCommitPreview, setLoadingCommitPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  /** V12.7：分批匯入進度（null＝目前沒有在匯入） */
  const [commitProgress, setCommitProgress] = useState<{ processed: number; total: number } | null>(null);

  function resetAll() {
    setStep(1);
    setFile(null);
    setPersonFile(null);
    setPersonInfo(null);
    setSheetPrep(null);
    setFileError(null);
    setAnalyzing(false);
    setAnalyzeError(null);
    setBatchId(null);
    setColumns([]);
    setTargetFields([]);
    setMapping({});
    setSummary(null);
    setRows([]);
    setFilterKey("ALL");
    setVisibleCount(20);
    setPendingTotal(0);
    setResolutionError(null);
    setCommitPreview(null);
    setCommitPreviewError(null);
    setCommitError(null);
    setCommitResult(null);
    setCommitProgress(null);
  }

  function handleFileChange(f: File | null) {
    setFileError(null);
    if (!f) {
      setFile(null);
      return;
    }
    const lower = f.name.toLowerCase();
    const okExt = [".xlsx", ".xls", ".csv"].some((ext) => lower.endsWith(ext));
    if (!okExt) {
      setFileError(`不支援的檔案格式「${f.name}」，請上傳 .xlsx、.xls 或 .csv 檔案`);
      setFile(null);
      return;
    }
    if (f.size > 10 * 1024 * 1024) {
      setFileError(`檔案太大（${(f.size / (1024 * 1024)).toFixed(1)}MB），單次上傳檔案不能超過 10MB`);
      setFile(null);
      return;
    }
    setFile(f);
  }

  async function runAnalyze(useCurrentMapping: boolean) {
    if (!file || !operatorUserId) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      if (personFile) form.append("personFile", personFile);
      form.append("operatorUserId", operatorUserId);
      if (useCurrentMapping) {
        form.append("mapping", JSON.stringify(mapping));
      }
      const res = await fetch("/api/import/devotee-precheck/analyze", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error ?? "分析失敗，請確認檔案內容");
        return;
      }
      setBatchId(data.batchId);
      setColumns(data.columns ?? []);
      setTargetFields(data.targetFields ?? []);
      setMapping(data.mapping ?? {});
      setSummary(data.summary ?? null);
      setRows(data.rows ?? []);
      setPersonInfo({ fileName: data.personFileName ?? null, rowCount: data.personRowCount ?? 0 });
      setSheetPrep(data.sheetPreparation ?? null);
      setFilterKey("ALL");
      setVisibleCount(20);
      // 尚未確認的成員數＝所有 REVIEW 且沒有 resolution 的成員
      setPendingTotal(
        (data.rows ?? []).reduce(
          (acc: number, r: AnalyzedRow) =>
            acc + (r.plan?.members.filter((m) => m.action === "REVIEW" && !m.resolution).length ?? 0),
          0
        )
      );
      setStep(useCurrentMapping ? 3 : 2);
    } catch {
      setAnalyzeError("無法連線到伺服器，請稍後再試");
    } finally {
      setAnalyzing(false);
    }
  }

  async function loadCommitPreview() {
    if (!batchId || !operatorUserId) return;
    setLoadingCommitPreview(true);
    setCommitPreviewError(null);
    try {
      const res = await fetch(
        `/api/import/devotee-precheck/${batchId}/commit-preview?operatorUserId=${encodeURIComponent(operatorUserId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setCommitPreviewError(data.error ?? "載入確認匯入資訊失敗");
        return;
      }
      setCommitPreview(data);
    } catch {
      setCommitPreviewError("無法連線到伺服器，請稍後再試");
    } finally {
      setLoadingCommitPreview(false);
    }
  }

  /**
   * V12.7：確認匯入（支援任意筆數）。
   *
   * **使用者只按一次這顆按鈕。** 分批完全發生在這個函式內部：後端每次處理
   * 一批（預設 100 戶）並回傳 `done` 與進度，`done === false` 就自動再呼叫
   * 一次繼續下一批，直到全部完成。
   *
   * 為什麼要在前端迴圈、而不是後端一次跑完 869 戶：
   *   - 單一 HTTP 請求跑兩萬多次資料庫往返會撞到 Render 的請求逾時
   *   - 分批回傳才能即時顯示「123 / 869 戶」，讓行政人員知道系統沒當機
   *
   * 中途失敗時：該批已完整回滾，先前成功的批次保留；再按一次會從沒做完的
   * 地方接續（後端以 row 狀態判斷，不會重複建立）。
   */
  async function handleCommit() {
    if (!batchId || !operatorUserId || committing) return; // 防止連點
    setCommitting(true);
    setCommitError(null);
    setCommitProgress(null);

    // 跨批次累加的統計數字（每一批只回傳該批的數量）
    const totals = {
      householdsCreated: 0,
      householdsUpdated: 0,
      membersCreated: 0,
      membersUpdated: 0,
      ancestorsCreated: 0,
      spiritsCreated: 0,
      skippedCount: 0,
      failedCount: 0,
      failures: [] as CommitResult["failures"],
      committedAt: new Date().toISOString(),
    };

    try {
      // 安全上限：避免後端若出現異常狀態導致無限迴圈。
      // 869 戶 ÷ 100 ≈ 9 批，1000 次已是極寬裕的裕度。
      for (let guard = 0; guard < 1000; guard++) {
        const res = await fetch(`/api/import/devotee-precheck/${batchId}/commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operatorUserId }),
        });
        const data = await res.json();
        if (!res.ok) {
          setCommitError(data.error ?? "確認匯入失敗");
          return;
        }

        totals.householdsCreated += data.householdsCreated ?? 0;
        totals.householdsUpdated += data.householdsUpdated ?? 0;
        totals.membersCreated += data.membersCreated ?? 0;
        totals.membersUpdated += data.membersUpdated ?? 0;
        totals.ancestorsCreated += data.ancestorsCreated ?? 0;
        totals.spiritsCreated += data.spiritsCreated ?? 0;
        totals.failedCount += data.failedCount ?? 0;
        if (Array.isArray(data.failures)) totals.failures.push(...data.failures);
        // 略過筆數與完成時間以最後一批的回報為準（後端算的是整批的值）
        totals.skippedCount = data.skippedCount ?? totals.skippedCount;
        totals.committedAt = data.committedAt ?? totals.committedAt;

        setCommitProgress({
          processed: data.processedHouseholds ?? 0,
          total: data.totalHouseholds ?? 0,
        });

        if (data.done) break;
      }

      setCommitResult(totals);
      setStep(5);
    } catch {
      setCommitError("無法連線到伺服器，請稍後再試。已完成的批次不會遺失，重新按一次即可從未完成的地方接續。");
    } finally {
      setCommitting(false);
      setCommitProgress(null);
    }
  }

  /**
   * V12.6 驗收修正（指令二）：送出某一位成員的人工決定。
   *
   * 寫入既有的 ImportRow.resolutionDecision／resolutionHouseholdId／
   * resolutionMemberId（以及 plan 內的逐成員決定），存進資料庫，
   * 重新整理不會消失。
   */
  async function saveResolution(
    rowId: string,
    memberName: string,
    decision: "KEEP_ORIGINAL" | "TRANSFER_IN" | "CREATE_NEW" | "SKIP",
    memberId?: string | null
  ) {
    if (!batchId || !operatorUserId) return;
    const key = `${rowId}::${memberName}`;
    setSavingResolution(key);
    setResolutionError(null);
    try {
      const res = await fetch(`/api/import/devotee-precheck/${batchId}/resolution`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId, rowId, memberName, decision, memberId: memberId ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResolutionError(data.error ?? "儲存處理方式失敗");
        return;
      }
      setPendingTotal(data.pendingTotal ?? 0);
      // 就地更新畫面狀態，不必重新載入整批
      setRows((prev) =>
        prev.map((r) =>
          r.id !== rowId
            ? r
            : {
                ...r,
                status: data.rowStatus ?? r.status,
                plan: r.plan
                  ? {
                      ...r.plan,
                      members: r.plan.members.map((m) =>
                        m.name === memberName
                          ? { ...m, resolution: { decision, memberId: memberId ?? null, householdId: null } }
                          : m
                      ),
                    }
                  : r.plan,
              }
        )
      );
    } catch {
      setResolutionError("無法連線到伺服器，請稍後再試");
    } finally {
      setSavingResolution(null);
    }
  }

  function pickFilter(k: FilterKey) {
    setFilterKey(k);
    setVisibleCount(20); // 切換分類時回到第一頁
  }

  function downloadErrorCsv() {
    if (!batchId || !operatorUserId) return;
    window.open(
      `/api/import/devotee-precheck/${batchId}/error-csv?operatorUserId=${encodeURIComponent(operatorUserId)}`,
      "_blank"
    );
  }

  // V12.6 驗收修正：依分類篩選後的完整清單與目前顯示範圍。
  const filteredRows = rows.filter((r) => matchesFilter(r, filterKey));
  const previewRows = filteredRows.slice(0, visibleCount);

  return (
    <div className="flex flex-col gap-6">
      {/* 步驟指示器 */}
      <div className="flex flex-wrap gap-2 rounded-3xl bg-white/70 p-4 shadow-card">
        {STEP_LABELS.map((label, i) => {
          const n = i + 1;
          const active = n === step;
          const done = n < step;
          return (
            <div
              key={label}
              className={`flex items-center gap-2 rounded-full px-3 py-1.5 text-xs ${
                active ? "bg-yolk-200 text-ink" : done ? "bg-sage-100 text-ink" : "bg-cream-100 text-ink-faint"
              }`}
            >
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/70 text-[11px]">
                {n}
              </span>
              {label}
            </div>
          );
        })}
      </div>

      {!operatorUserId && (
        <div className="rounded-3xl bg-white/70 p-6 text-sm text-blossom-300 shadow-card">
          請先在上方選擇目前操作人員，才能上傳與分析檔案。
        </div>
      )}

      {/* ① 上傳檔案 */}
      {step === 1 && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第一步：上傳檔案</h3>
          <p className="text-xs text-ink-faint">
            正式格式一列代表一戶，「所有成員」欄以逗號分隔，內含一般家戶成員、歷代祖先與乙位正魂三種資料，
            系統會依名稱自動分類（含「歷代祖先」→ 歷代祖先牌位；含「乙位正魂」→ 乙位正魂牌位；其餘 → 一般成員）。
            「家庭成員」與「普渡牌位資料筆數」兩個數量欄僅供核對，不會寫入資料。
            支援 .xlsx、.xls、.csv，單次僅能上傳一個檔案，檔案大小上限 10MB。上傳後不會立即寫入任何正式資料。
          </p>
          <div>
            <label className="mb-1 block text-xs text-ink-soft">① 家戶 Excel（必要）</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-ink"
            />
          </div>

          {/* V12.6 指令四／五：可選的第二份個人資料 Excel */}
          <div className="rounded-2xl bg-mist-50 p-4">
            <label className="mb-1 block text-xs text-ink-soft">② 個人資料 Excel（選填）</label>
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={(e) => setPersonFile(e.target.files?.[0] ?? null)}
              className="w-full text-sm text-ink"
            />
            <p className="mt-2 text-xs leading-relaxed text-ink-faint">
              用來補足每位成員的手機／市話／Email／國曆生日／農曆生日／地址。
              欄名沿用既有慣例（家戶編號、姓名、性別、手機、市話、Email、國曆生日、農曆生日、地址、備註），
              不需要修改你現有的檔案格式。
              <br />
              這一份**不會單獨產生匯入資料**，只會依姓名（有填家戶編號時更精準）掛回家戶檔的成員上。
              有了這些欄位，系統才能用「姓名＋電話／生日」多欄判斷是不是同一個人；
              沒有上傳時，同名一律會被列為疑似重複交由你確認，不會自動合併。
            </p>
            {personFile && <p className="mt-1 text-xs text-ink-soft">已選擇：{personFile.name}</p>}
          </div>

          {fileError && <p className="text-xs text-blossom-300">{fileError}</p>}
          {analyzeError && <p className="text-xs text-blossom-300">{analyzeError}</p>}
          <button
            type="button"
            disabled={!file || !operatorUserId || analyzing}
            onClick={() => runAnalyze(false)}
            className="min-h-11 w-full rounded-full bg-ink px-6 text-sm text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint sm:w-fit"
          >
            {analyzing ? "分析中…" : "上傳並分析"}
          </button>
        </div>
      )}

      {/* ② 欄位對照 */}
      {step === 2 && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第二步：欄位對照</h3>
          <p className="text-xs text-ink-faint">
            系統已依欄位名稱自動猜測對應，請確認或手動調整每一欄要對應到哪個系統欄位；選「不匯入」的欄位不會被讀取。
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="pb-2 pr-4">Excel 欄位名稱</th>
                  <th className="pb-2">對應到</th>
                </tr>
              </thead>
              <tbody>
                {columns.map((col) => (
                  <tr key={col} className="border-t border-cream-200">
                    <td className="py-2 pr-4 text-ink">{col}</td>
                    <td className="py-2">
                      {/*
                        V12.6 驗收修正：同一個系統欄位不可以被兩個 Excel 欄位
                        佔用——applyMapping() 會靜默覆蓋，其中一欄的資料會整個
                        消失（正式 Excel 的「歷代祖先」與「乙位正魂」就是踩到
                        這個）。這裡把已被其他欄位選走的選項標示並停用，
                        使用者不可能再選到重複的目標欄位。
                      */}
                      <select
                        value={mapping[col] ?? ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value || null }))}
                        className="min-h-11 w-full rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink sm:max-w-xs"
                      >
                        <option value="">（不匯入）</option>
                        {targetFields.map((f) => {
                          const takenBy = Object.entries(mapping).find(
                            ([otherCol, target]) => target === f.key && otherCol !== col
                          )?.[0];
                          return (
                            <option key={f.key} value={f.key} disabled={Boolean(takenBy)}>
                              {f.label}
                              {f.required ? "（必填）" : ""}
                              {takenBy ? `（已由「${takenBy}」使用）` : ""}
                            </option>
                          );
                        })}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analyzeError && <p className="text-xs text-blossom-300">{analyzeError}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-11 w-full rounded-full border border-cream-200 px-6 text-sm text-ink-soft sm:w-auto"
            >
              ← 重新上傳
            </button>
            <button
              type="button"
              disabled={analyzing}
              onClick={() => runAnalyze(true)}
              className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint"
            >
              {analyzing ? "重新分析中…" : "套用欄位對照並預覽 →"}
            </button>
          </div>
        </div>
      )}

      {/* ③ 預覽與統計 */}
      {step === 3 && summary && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第三步：預覽與統計</h3>
          {/* V12.8：合併儲存格前處理說明 */}
          {sheetPrep && sheetPrep.mergedRowCount > 0 && (
            <p className="rounded-2xl bg-sage-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
              偵測到合併儲存格格式：Excel 共 {sheetPrep.excelRowCount} 列，已依家戶編號合併成{" "}
              <span className="text-ink">{sheetPrep.householdRowCount} 戶</span>
              （{sheetPrep.mergedRowCount} 列被併入上方家戶）。
              <br />
              家戶編號／戶名／主要聯絡人／主要地址／數量欄位空白時自動沿用上一列；「所有成員」則是把同一戶各列的名單串接起來，
              不會把同一個人重複建立。
            </p>
          )}

          {personInfo?.fileName && (
            <p className="rounded-2xl bg-mist-50 px-4 py-2.5 text-xs text-ink-soft">
              已套用個人資料 Excel：{personInfo.fileName}（{personInfo.rowCount} 筆），
              成員比對會使用手機／市話／生日等欄位，判斷比只用姓名精準。
            </p>
          )}

          {/* V12.6 驗收修正（指令一）：每個分類都可點擊，點了只看該分類的完整清單 */}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:gap-3">
            <FilterPill k="ALL" count={summary.total} label="總筆數（戶）" active={filterKey} onPick={pickFilter} />
            <FilterPill k="HOUSEHOLD_CREATE" count={summary.householdsToCreate} active={filterKey} onPick={pickFilter} tone="sage" />
            <FilterPill k="HOUSEHOLD_UPDATE" count={summary.householdsToUpdate} active={filterKey} onPick={pickFilter} tone="mist" />
            <FilterPill k="MEMBER_CREATE" count={summary.membersToCreate} active={filterKey} onPick={pickFilter} tone="sage" />
            <FilterPill k="MEMBER_UPDATE" count={summary.membersToUpdate} active={filterKey} onPick={pickFilter} tone="mist" />
            <FilterPill k="SUSPECTED_DUPLICATE" count={summary.suspectedDuplicate} active={filterKey} onPick={pickFilter} tone="yolk" />
            <FilterPill k="FIELD_CONFLICT" count={summary.fieldConflicts} active={filterKey} onPick={pickFilter} tone="yolk" />
            <FilterPill k="FORMAT_ERROR" count={summary.formatError} active={filterKey} onPick={pickFilter} tone="blossom" />
            <FilterPill k="INCOMPLETE_DATA" count={summary.incompleteData} active={filterKey} onPick={pickFilter} tone="blossom" />
            <FilterPill k="EXCLUDED" count={summary.excluded} active={filterKey} onPick={pickFilter} tone="cream" />
            <StatPill label="高可信度自動配對" value={summary.autoMatchedHighConfidence} tone="mist" />
          </div>

          {summary.suspectedDuplicate > 0 && (
            <p className="rounded-2xl bg-yolk-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
              有 {summary.suspectedDuplicate} 列被判定為「疑似重複」，
              <span className="text-ink">預設不會匯入</span>
              。系統不會自動把同名的人合併，也不會自動把已經在別戶的人轉戶——
              請在下方逐列檢視原因後，修改 Excel 或人工處理再重新上傳。
            </p>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-ink-faint">
              目前顯示「{FILTER_LABEL[filterKey]}」
              {filteredRows.length > 0
                ? `第 1–${Math.min(visibleCount, filteredRows.length)} 筆，共 ${filteredRows.length} 筆`
                : "：沒有符合的資料"}
            </p>
            {filterKey !== "ALL" && (
              <button
                type="button"
                onClick={() => pickFilter("ALL")}
                className="min-h-11 text-xs text-ink-soft underline-offset-4 hover:text-ink hover:underline sm:min-h-0"
              >
                清除篩選
              </button>
            )}
          </div>
          <div className="flex flex-col gap-3">
            {previewRows.map((r) => (
              <div key={r.id} className="rounded-2xl border border-cream-200 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs text-ink-faint">第 {r.rowNumber} 列</span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_CLASS[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <p className="mt-2 text-sm text-ink">
                  家戶：{dash(r.household.name)}（編號 {dash(r.household.code)}） / 主要聯絡人：
                  {dash(r.household.contactName)} / 家戶成員：{r.memberNames.length} 人 / 歷代祖先：
                  {r.ancestorNames.length} 筆 / 乙位正魂：{r.spiritNames.length} 筆
                </p>
                {r.household.address && <p className="mt-1 text-xs text-ink-soft">地址：{r.household.address}</p>}
                {/*
                  V12.6 驗收修正：正式 Excel 的「所有成員」是一欄混合資料，
                  由系統依名稱分類。這裡把分類結果分三行列出，讓行政人員
                  一眼確認「哪些被當成一般成員、哪些被當成牌位」。
                */}
                {r.memberNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">
                    一般家戶成員（{r.memberNames.length}）：{r.memberNames.join("、")}
                  </p>
                )}
                {r.ancestorNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">
                    歷代祖先（{r.ancestorNames.length}）：{r.ancestorNames.join("、")}
                  </p>
                )}
                {r.spiritNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">
                    乙位正魂（{r.spiritNames.length}）：{r.spiritNames.join("、")}
                  </p>
                )}
                {/*
                  V12.6 指令六：每一筆都要顯示「預計動作／系統既有資料／
                  問題原因／可選處理方式」。手機版用縱向卡片，不使用表格，
                  所以不會出現橫向捲動。
                */}
                {r.plan && (
                  <div className="mt-3 flex flex-col gap-2 rounded-xl bg-cream-50 p-3">
                    <p className="text-xs text-ink-soft">
                      預計動作：
                      <span className="text-ink">
                        {r.plan.householdAction === "CREATE"
                          ? "新增家戶"
                          : r.plan.householdAction === "UPDATE"
                            ? `更新既有家戶${r.plan.matchedHouseholdId ? `（${r.plan.matchedHouseholdId}）` : ""}`
                            : "不會匯入"}
                      </span>
                      {r.plan.matchedViaAlias && (
                        <span className="ml-1 rounded-full bg-mist-100 px-2 py-0.5 text-[11px]">
                          透過舊編號對照
                        </span>
                      )}
                    </p>

                    {r.plan.existingHousehold && (
                      <p className="text-xs text-ink-faint">
                        系統既有：戶名 {dash(r.plan.existingHousehold.name)}／主要聯絡人{" "}
                        {dash(r.plan.existingHousehold.contactName)}／地址{" "}
                        {dash(r.plan.existingHousehold.address)}
                      </p>
                    )}

                    {r.plan.fieldConflicts.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {r.plan.fieldConflicts.map((c) => (
                          <p key={c.field} className="text-xs text-ink-soft">
                            ⚠️ 欄位衝突「{c.field}」：Excel「{c.excelValue}」↔ 系統「{c.existingValue}」
                            <span className="text-ink-faint">　→ 匯入後以 Excel 為準</span>
                          </p>
                        ))}
                      </div>
                    )}

                    {r.plan.keptExistingFields.length > 0 && (
                      <p className="text-xs text-ink-faint">
                        Excel 未填「{r.plan.keptExistingFields.join("、")}」→ 保留系統既有資料，不會被清空
                      </p>
                    )}

                    {r.plan.members.length > 0 && (
                      <div className="flex flex-col gap-1">
                        {r.plan.members.map((m) => (
                          <div key={m.name} className="text-xs">
                            <span className="text-ink">{m.name}</span>
                            <span
                              className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${
                                m.action === "CREATE"
                                  ? "bg-sage-100 text-ink"
                                  : m.action === "UPDATE"
                                    ? "bg-mist-100 text-ink"
                                    : m.action === "SKIP"
                                      ? "bg-cream-200 text-ink-faint"
                                      : "bg-yolk-200 text-ink"
                              }`}
                            >
                              {m.action === "CREATE"
                                ? "新增信眾"
                                : m.action === "UPDATE"
                                  ? "更新既有信眾"
                                  : m.action === "SKIP"
                                    ? "已存在，略過"
                                    : "需人工確認"}
                            </span>
                            {m.action === "REVIEW" && (
                              <MemberResolutionControls
                                rowId={r.id}
                                member={m}
                                targetHouseholdLabel={`${dash(r.household.name)}（${dash(r.household.code)}）`}
                                saving={savingResolution === `${r.id}::${m.name}`}
                                onSave={saveResolution}
                              />
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/*
                  V12.6 驗收修正（指令三）：錯誤與提醒分開顯示，並標明是否
                  阻擋匯入——「空白但會保留系統既有值」屬於提醒，不是錯誤。
                */}
                {r.errors.length > 0 && (
                  <div className="mt-2 rounded-xl bg-blossom-50 px-3 py-2">
                    <p className="text-xs text-ink">
                      ⛔ 阻擋匯入（第 {r.rowNumber} 列／家戶編號 {dash(r.household.code)}／戶名{" "}
                      {dash(r.household.name)}）
                    </p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {r.errors.map((e) => (
                        <li key={e} className="text-xs text-ink-soft">
                          ・{e}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-1 text-xs text-ink-faint">
                      建議處理：在 Excel 補上缺少的欄位後重新上傳；家戶編號無法補齊時，請改由「新增家戶」手動建立。
                    </p>
                  </div>
                )}
                {r.warnings.length > 0 && (
                  <div className="mt-2 rounded-xl bg-cream-100 px-3 py-2">
                    <p className="text-xs text-ink-soft">ℹ️ 提醒（不阻擋匯入）</p>
                    <ul className="mt-1 flex flex-col gap-0.5">
                      {r.warnings.map((w) => (
                        <li key={w} className="text-xs text-ink-faint">
                          ・{w}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </div>
          {filteredRows.length > previewRows.length && (
            <button
              type="button"
              onClick={() => setVisibleCount((n) => n + 50)}
              className="min-h-11 w-full rounded-full border border-cream-200 text-sm text-ink-soft sm:w-auto sm:px-6"
            >
              載入更多（還有 {filteredRows.length - previewRows.length} 筆）
            </button>
          )}

          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-11 w-full rounded-full border border-cream-200 px-6 text-sm text-ink-soft sm:w-auto"
            >
              ← 回欄位對照
            </button>
            <button
              type="button"
              onClick={async () => {
                setStep(4);
                await loadCommitPreview();
              }}
              className="min-h-11 w-full rounded-full bg-ink px-6 text-sm text-cream-50 sm:w-auto"
            >
              下一步：確認匯入 →
            </button>
          </div>
        </div>
      )}

      {/* ④ 確認匯入 */}
      {step === 4 && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第四步：確認匯入</h3>
          {loadingCommitPreview && <p className="text-xs text-ink-faint">載入中…</p>}
          {commitPreviewError && <p className="text-xs text-blossom-300">{commitPreviewError}</p>}
          {commitPreview && (
            <>
              <div className="grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap sm:gap-3">
                <StatPill label="即將新增家戶" value={commitPreview.newHouseholdCount} tone="sage" />
                <StatPill label="即將更新家戶" value={commitPreview.updateHouseholdCount} tone="mist" />
                <StatPill label="即將新增成員" value={commitPreview.newMemberCount} tone="sage" />
                <StatPill label="即將新增祖先" value={commitPreview.newAncestorCount} tone="sage" />
                <StatPill label="即將新增乙位正魂" value={commitPreview.newSpiritCount} tone="sage" />
                <StatPill label="不處理筆數" value={commitPreview.skippedCount} tone="blossom" />
              </div>
              {/* V12.6 驗收修正（指令四）：尚有未完成人工確認時，明確顯示筆數並停用匯入 */}
              {(commitPreview.pendingResolutions ?? 0) > 0 && (
                <p className="rounded-2xl bg-yolk-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
                  還有 <span className="text-ink">{commitPreview.pendingResolutions}</span> 位成員的疑似重複尚未確認處理方式，
                  正式匯入已停用。請回到上一步，點「疑似重複」分類逐一選擇處理方式後再回來。
                </p>
              )}
              <p className="text-xs leading-relaxed text-ink-faint">
                只有狀態為「可匯入」的家戶會被處理；資料不完整、格式錯誤的列一律不會匯入。已經存在的家戶成員／歷代祖先／乙位正魂會保留原樣，不會被覆蓋或刪除，只會新增找不到的資料。
                <br />
                {/* V12.7：單次筆數上限已移除，改以分批交易處理任意筆數 */}
                資料筆數沒有上限，按一次即可完成全部。系統會自動分批寫入並顯示進度，過程中請不要關閉頁面。
              </p>
              {commitError && (
                <p className="rounded-2xl bg-blossom-50 px-4 py-3 text-xs leading-relaxed text-ink-soft">
                  {commitError}
                </p>
              )}

              {/* V12.7：分批匯入進度，讓使用者知道系統沒有當機 */}
              {committing && (
                <div className="rounded-2xl bg-mist-50 px-4 py-3">
                  <p className="text-sm text-ink">
                    正在匯入…
                    {commitProgress && commitProgress.total > 0 && (
                      <span className="ml-2">
                        {commitProgress.processed} / {commitProgress.total} 戶
                      </span>
                    )}
                  </p>
                  {commitProgress && commitProgress.total > 0 && (
                    <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-cream-200">
                      <div
                        className="h-full rounded-full bg-sage-300 transition-all"
                        style={{
                          width: `${Math.min(100, Math.round((commitProgress.processed / commitProgress.total) * 100))}%`,
                        }}
                      />
                    </div>
                  )}
                  <p className="mt-2 text-xs text-ink-faint">
                    系統正在分批寫入，請不要關閉或重新整理頁面。中途若中斷，已完成的部分不會遺失，重新按一次會從未完成的地方接續。
                  </p>
                </div>
              )}

              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
                <button
                  type="button"
                  disabled={committing}
                  onClick={() => setStep(3)}
                  className="min-h-11 w-full rounded-full border border-cream-200 px-6 text-sm text-ink-soft disabled:opacity-40 sm:w-auto"
                >
                  ← 回上一步
                </button>
                <button
                  type="button"
                  disabled={committing || (commitPreview.pendingResolutions ?? 0) > 0}
                  onClick={handleCommit}
                  className="min-h-11 w-full rounded-full bg-ink px-6 text-sm text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint sm:w-auto"
                >
                  {committing ? "匯入中，請稍候…" : "確認匯入"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ⑤ 匯入結果 */}
      {step === 5 && commitResult && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第五步：匯入結果</h3>
          <div className="grid grid-cols-2 gap-2 text-xs sm:flex sm:flex-wrap sm:gap-3">
            <StatPill label="新增家戶" value={commitResult.householdsCreated} tone="sage" />
            <StatPill label="更新家戶" value={commitResult.householdsUpdated} tone="mist" />
            <StatPill label="新增信眾" value={commitResult.membersCreated} tone="sage" />
            <StatPill label="更新信眾" value={commitResult.membersUpdated ?? 0} tone="mist" />
            <StatPill label="新增祖先" value={commitResult.ancestorsCreated} tone="sage" />
            <StatPill label="新增乙位正魂" value={commitResult.spiritsCreated} tone="sage" />
            <StatPill label="不處理" value={commitResult.skippedCount} />
            <StatPill label="失敗" value={commitResult.failedCount} tone="blossom" />
          </div>
          <p className="text-xs text-ink-faint">
            完成時間：{new Date(commitResult.committedAt).toLocaleString("zh-TW")}
          </p>
          {commitResult.failures.length > 0 && (
            <div className="rounded-2xl bg-blossom-100 p-4">
              <p className="text-xs text-blossom-300">失敗清單：</p>
              <ul className="mt-2 flex flex-col gap-1 text-xs text-blossom-300">
                {commitResult.failures.map((f, i) => (
                  <li key={i}>
                    第 {f.rowNumber} 列・{dash(f.householdName)}：{f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            <button
              type="button"
              onClick={downloadErrorCsv}
              className="min-h-11 w-full rounded-full border border-cream-200 px-6 text-sm text-ink-soft sm:w-auto"
            >
              下載錯誤清單 CSV
            </button>
            {batchId && (
              <Link
                href="/system-center"
                className="flex min-h-10 items-center rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
              >
                回系統管理中心
              </Link>
            )}
            <button
              type="button"
              onClick={resetAll}
              className="min-h-11 w-full rounded-full bg-ink px-6 text-sm text-cream-50 sm:w-auto"
            >
              匯入下一批
            </button>
          </div>
        </div>
      )}

      {step < 5 && operatorUser && (
        <p className="text-xs text-ink-faint">目前操作人員：{operatorUser.name}</p>
      )}
    </div>
  );
}

/**
 * V12.6 驗收修正（指令二）：單一成員的人工確認控制項。
 *
 * 提供四個真正可按的選項；選「保留原家戶」或「轉入目前家戶」時，還必須
 * 選定是哪一位既有信眾（候選人會顯示姓名、原家戶、比對依據）。
 * 送出後寫進資料庫的既有 resolution* 欄位，重新整理不會消失。
 */
function MemberResolutionControls({
  rowId,
  member,
  targetHouseholdLabel,
  saving,
  onSave,
}: {
  rowId: string;
  member: PlannedMember;
  targetHouseholdLabel: string;
  saving: boolean;
  onSave: (
    rowId: string,
    memberName: string,
    decision: "KEEP_ORIGINAL" | "TRANSFER_IN" | "CREATE_NEW" | "SKIP",
    memberId?: string | null
  ) => void;
}) {
  const [picked, setPicked] = useState<string>(member.candidates[0]?.memberId ?? "");
  const decided = member.resolution?.decision ?? null;

  const DECISION_LABEL: Record<string, string> = {
    KEEP_ORIGINAL: "保留原家戶，不移動",
    TRANSFER_IN: `轉入目前家戶 ${targetHouseholdLabel}`,
    CREATE_NEW: "建立為新信眾",
    SKIP: "略過此人",
  };

  if (decided) {
    return (
      <div className="mt-1 rounded-lg bg-sage-50 px-3 py-2">
        <p className="text-xs text-ink">
          ✓ 已確認：{DECISION_LABEL[decided]}
          {member.resolution?.memberId && (
            <span className="text-ink-faint">
              　（
              {member.candidates.find((c) => c.memberId === member.resolution?.memberId)?.householdName ?? "既有信眾"}
              ）
            </span>
          )}
        </p>
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(rowId, member.name, decided, member.resolution?.memberId ?? null)}
          className="mt-1 min-h-11 text-xs text-ink-faint underline-offset-4 hover:text-ink hover:underline sm:min-h-0"
        >
          重新送出
        </button>
      </div>
    );
  }

  return (
    <div className="mt-1 flex flex-col gap-2 rounded-lg bg-white px-3 py-2">
      <p className="text-ink-soft">{member.reason}</p>

      {member.candidates.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-ink-faint">系統找到的既有信眾：</span>
          {member.candidates.map((c) => (
            <label key={c.memberId} className="flex min-h-11 items-start gap-2 sm:min-h-0">
              <input
                type="radio"
                name={`cand-${rowId}-${member.name}`}
                checked={picked === c.memberId}
                onChange={() => setPicked(c.memberId)}
                className="mt-1"
              />
              <span>
                <span className="text-ink">{c.name}</span>
                <span className="ml-1 text-ink-faint">
                  {c.householdName}（{c.householdId}）
                  {c.inOtherHousehold ? "・在其他家戶" : "・在本戶"}
                </span>
                <span className="block text-ink-faint">比對依據：{c.matchedFields.join("＋")}（{c.confidence}）</span>
              </span>
            </label>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-1.5 sm:flex-row sm:flex-wrap">
        <button
          type="button"
          disabled={saving || !picked}
          onClick={() => onSave(rowId, member.name, "KEEP_ORIGINAL", picked)}
          className="min-h-11 rounded-full bg-cream-100 px-3 text-xs text-ink transition hover:bg-cream-200 disabled:opacity-40 sm:min-h-9"
        >
          ① 保留原家戶
        </button>
        <button
          type="button"
          disabled={saving || !picked}
          onClick={() => onSave(rowId, member.name, "TRANSFER_IN", picked)}
          className="min-h-11 rounded-full bg-mist-100 px-3 text-xs text-ink transition hover:bg-mist-200 disabled:opacity-40 sm:min-h-9"
        >
          ② 轉入目前家戶
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(rowId, member.name, "CREATE_NEW")}
          className="min-h-11 rounded-full bg-sage-100 px-3 text-xs text-ink transition hover:bg-sage-200 disabled:opacity-40 sm:min-h-9"
        >
          ③ 建立為新信眾
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => onSave(rowId, member.name, "SKIP")}
          className="min-h-11 rounded-full bg-cream-200 px-3 text-xs text-ink-soft transition hover:bg-cream-300 disabled:opacity-40 sm:min-h-9"
        >
          ④ 略過此人
        </button>
      </div>
      {saving && <span className="text-ink-faint">儲存中…</span>}
    </div>
  );
}

/** V12.6 驗收修正：可點擊的分類籌碼。 */
function FilterPill({
  k,
  count,
  label,
  active,
  onPick,
  tone,
}: {
  k: FilterKey;
  count: number;
  label?: string;
  active: FilterKey;
  onPick: (k: FilterKey) => void;
  tone?: "sage" | "yolk" | "blossom" | "mist" | "cream";
}) {
  const isActive = active === k;
  const toneClass =
    tone === "sage"
      ? "bg-sage-100"
      : tone === "yolk"
        ? "bg-yolk-100"
        : tone === "blossom"
          ? "bg-blossom-100"
          : tone === "mist"
            ? "bg-mist-100"
            : "bg-cream-100";
  return (
    <button
      type="button"
      onClick={() => onPick(k)}
      className={`min-h-11 rounded-full px-3 py-1.5 text-left text-xs transition sm:min-h-0 ${toneClass} ${
        isActive ? "ring-2 ring-ink-soft text-ink" : "text-ink-soft hover:text-ink"
      }`}
    >
      <span className="block">{label ?? FILTER_LABEL[k]}</span>
      <span className="block text-sm text-ink">{count}</span>
    </button>
  );
}

function StatPill({ label, value, tone }: { label: string; value: number; tone?: "sage" | "yolk" | "blossom" | "mist" | "cream" }) {
  const toneClass =
    tone === "sage"
      ? "bg-sage-100 text-ink"
      : tone === "yolk"
        ? "bg-yolk-100 text-ink"
        : tone === "blossom"
          ? "bg-blossom-100 text-ink"
          : tone === "mist"
            ? "bg-mist-100 text-ink"
            : "bg-cream-100 text-ink-soft";
  return (
    <span className={`rounded-full px-3 py-1.5 ${toneClass}`}>
      {label}：{value}
    </span>
  );
}
