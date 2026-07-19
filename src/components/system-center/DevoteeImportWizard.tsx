"use client";

import { useState } from "react";
import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";
import { formatSolarDate } from "@/lib/lunar";

/**
 * V11.3「信眾資料匯入預檢中心」——六步驟精靈（需求「UI 需求」）：
 *   ① 上傳檔案 → ② 欄位對照 → ③ 預覽與統計 → ④ 疑似重複／待確認家戶處理
 *   → ⑤ 確認匯入 → ⑥ 匯入結果
 *
 * ⚠️ 這裡的型別「刻意」不直接沿用 devoteeImportBatch.ts 的
 * AnalyzedDevoteeRow／NormalizedMemberFields——那些型別的 solarBirthDate
 * 是 Date，但這支元件收到的是「經過 fetch()／JSON 序列化」之後的資料，
 * Date 早就變成 ISO 字串了。如果直接沿用伺服器端型別，TypeScript 會誤以為
 * solarBirthDate 是 Date，實際上是字串，容易埋下「呼叫 Date 方法卻在執行期
 * 才發現是字串」的 bug。這裡改成明確定義「JSON 傳輸後的形狀」，是同一份
 * 資料的「線上格式」，不是重複設計一套新邏輯。
 */

type ClientHouseholdFields = {
  code: string;
  contactName: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  companyName: string | null;
  notes: string | null;
};

type ClientMemberFields = {
  name: string;
  gender: string | null;
  solarBirthDate: string | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  birthHour: string | null;
  relationToHead: string;
  isDeceased: boolean;
  yangshangName: string | null;
  notes: string | null;
};

type DuplicateCandidate = {
  tier: "HIGH" | "MEDIUM";
  reasons: string[];
  existingHouseholdId: string;
  existingHouseholdName: string;
  existingMemberId: string | null;
  existingMemberName: string | null;
};

type RowStatus =
  | "READY_TO_IMPORT"
  | "SUSPECTED_DUPLICATE"
  | "INCOMPLETE_DATA"
  | "FORMAT_ERROR"
  | "HOUSEHOLD_UNCERTAIN"
  | "EXCLUDED"
  | "IMPORTED";

type ResolutionDecision = "CONFIRMED_DUPLICATE" | "CONFIRMED_NOT_DUPLICATE" | "ASSIGN_HOUSEHOLD" | "SKIP";

type AnalyzedRow = {
  id: string;
  rowNumber: number;
  household: ClientHouseholdFields;
  member: ClientMemberFields;
  status: RowStatus;
  effectiveHouseholdId: string | null;
  errors: string[];
  warnings: string[];
  candidates: DuplicateCandidate[];
  groupReason: string | null;
  resolution: { decision: ResolutionDecision; householdId: string | null; note: string | null } | null;
};

type Summary = {
  total: number;
  readyToImport: number;
  suspectedDuplicate: number;
  incompleteData: number;
  formatError: number;
  householdUncertain: number;
  excluded: number;
};

type TargetField = { key: string; label: string; required?: boolean };

type CommitPreview = {
  newHouseholdCount: number;
  newMemberCount: number;
  skippedCount: number;
  suspectedDuplicateCount: number;
  errorCount: number;
  overCap: boolean;
  capMessage: string | null;
};

type CommitResult = {
  householdsCreated: number;
  membersCreated: number;
  skippedCount: number;
  failedCount: number;
  failures: { rowNumber: number; name: string | null; error: string }[];
  committedAt: string;
};

const STEP_LABELS = ["上傳檔案", "欄位對照", "預覽與統計", "疑似重複／待確認家戶", "確認匯入", "匯入結果"];

const STATUS_LABEL: Record<RowStatus, string> = {
  READY_TO_IMPORT: "可新增",
  SUSPECTED_DUPLICATE: "疑似重複",
  INCOMPLETE_DATA: "資料不完整",
  FORMAT_ERROR: "格式錯誤",
  HOUSEHOLD_UNCERTAIN: "待確認家戶",
  EXCLUDED: "不匯入",
  IMPORTED: "已匯入",
};

// ⚠️ 顏色僅使用 tailwind.config.ts 實際定義的色階（yolk/blossom/mist/sage
// 只到 300，ink 只有 DEFAULT/soft/faint，沒有數字色階）。專案裡其他既有
// 檔案雖然有用到 text-blossom-400／text-sage-500／text-mist-500 這類
// 未定義的色階（Tailwind 對沒定義的色階不會產生任何樣式，等於沒上色），
// 但那是既有模組的既有寫法，本輪範圍不包含修改其他模組或調色盤設定
// （見交付報告「發現但未處理」），這裡新增的畫面刻意只用確定會生效的色階。
const STATUS_BADGE_CLASS: Record<RowStatus, string> = {
  READY_TO_IMPORT: "bg-sage-200 text-ink",
  SUSPECTED_DUPLICATE: "bg-yolk-200 text-ink",
  INCOMPLETE_DATA: "bg-blossom-200 text-ink",
  FORMAT_ERROR: "bg-blossom-200 text-ink",
  HOUSEHOLD_UNCERTAIN: "bg-mist-200 text-ink",
  EXCLUDED: "bg-cream-200 text-ink-faint",
  IMPORTED: "bg-sage-200 text-ink",
};

const dash = (v: string | null | undefined): string => (v && v.trim().length > 0 ? v : "—");

function formatDateCell(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatSolarDate(d);
}

function formatLunarCell(row: ClientMemberFields): string {
  if (row.lunarBirthYear) {
    return `農曆 ${row.lunarBirthYear}/${row.lunarBirthMonth ?? "—"}/${row.lunarBirthDay ?? "—"}${row.lunarIsLeapMonth ? "（閏）" : ""}`;
  }
  if (row.lunarBirthMonth && row.lunarBirthDay) {
    return `農曆 ${row.lunarBirthMonth}月${row.lunarBirthDay}日`;
  }
  return "—";
}

export default function DevoteeImportWizard() {
  const { operatorUserId, operatorUser } = useOperator();

  const [step, setStep] = useState(1);

  // ---- 檔案（保留在瀏覽器記憶體，欄位對照調整後可以重新分析同一個檔案，不用重新上傳） ----
  const [file, setFile] = useState<File | null>(null);
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

  // ---- 疑似重複／待確認家戶：人工決定 ----
  const [refreshing, setRefreshing] = useState(false);
  const [openResolveRowId, setOpenResolveRowId] = useState<string | null>(null);
  const [resolveDecision, setResolveDecision] = useState<ResolutionDecision>("SKIP");
  const [resolveHouseholdId, setResolveHouseholdId] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [resolveSubmitting, setResolveSubmitting] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);

  // ---- 確認匯入 ----
  const [commitPreview, setCommitPreview] = useState<CommitPreview | null>(null);
  const [commitPreviewError, setCommitPreviewError] = useState<string | null>(null);
  const [loadingCommitPreview, setLoadingCommitPreview] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);

  function resetAll() {
    setStep(1);
    setFile(null);
    setFileError(null);
    setAnalyzing(false);
    setAnalyzeError(null);
    setBatchId(null);
    setColumns([]);
    setTargetFields([]);
    setMapping({});
    setSummary(null);
    setRows([]);
    setOpenResolveRowId(null);
    setCommitPreview(null);
    setCommitPreviewError(null);
    setCommitError(null);
    setCommitResult(null);
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
      setStep(useCurrentMapping ? 3 : 2);
    } catch {
      setAnalyzeError("無法連線到伺服器，請稍後再試");
    } finally {
      setAnalyzing(false);
    }
  }

  async function fetchBatchView() {
    if (!batchId || !operatorUserId) return;
    setRefreshing(true);
    try {
      const res = await fetch(
        `/api/import/devotee-precheck/${batchId}?operatorUserId=${encodeURIComponent(operatorUserId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error ?? "載入批次失敗");
        return;
      }
      setSummary(data.summary ?? null);
      setRows(data.rows ?? []);
    } catch {
      setAnalyzeError("無法連線到伺服器，請稍後再試");
    } finally {
      setRefreshing(false);
    }
  }

  function openResolvePanel(row: AnalyzedRow) {
    setOpenResolveRowId(row.id);
    setResolveError(null);
    setResolveDecision(row.resolution?.decision ?? "SKIP");
    setResolveHouseholdId(row.resolution?.householdId ?? "");
    setResolveNote(row.resolution?.note ?? "");
  }

  async function submitResolve(rowId: string) {
    if (!batchId || !operatorUserId) return;
    if (resolveDecision === "ASSIGN_HOUSEHOLD" && !resolveHouseholdId.trim()) {
      setResolveError("指定歸屬家戶時必須輸入家戶編號");
      return;
    }
    setResolveSubmitting(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/import/devotee-precheck/${batchId}/rows/${rowId}/resolve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId,
          decision: resolveDecision,
          householdId: resolveHouseholdId.trim() || null,
          note: resolveNote.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResolveError(data.error ?? "儲存決定失敗");
        return;
      }
      setOpenResolveRowId(null);
      await fetchBatchView();
    } catch {
      setResolveError("無法連線到伺服器，請稍後再試");
    } finally {
      setResolveSubmitting(false);
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

  async function handleCommit() {
    if (!batchId || !operatorUserId || committing) return; // 防止連點：commit 期間按鈕會被 disabled，這裡再做一層防呆
    setCommitting(true);
    setCommitError(null);
    try {
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
      setCommitResult(data);
      setStep(6);
    } catch {
      setCommitError("無法連線到伺服器，請稍後再試");
    } finally {
      setCommitting(false);
    }
  }

  function downloadErrorCsv() {
    if (!batchId || !operatorUserId) return;
    window.open(
      `/api/import/devotee-precheck/${batchId}/error-csv?operatorUserId=${encodeURIComponent(operatorUserId)}`,
      "_blank"
    );
  }

  const attentionRows = rows.filter((r) => r.status === "SUSPECTED_DUPLICATE" || r.status === "HOUSEHOLD_UNCERTAIN");
  const previewRows = rows.slice(0, 20);

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
            支援 .xlsx、.xls、.csv，單次僅能上傳一個檔案，檔案大小上限 10MB。上傳後不會立即寫入任何正式資料。
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
            className="text-sm text-ink"
          />
          {fileError && <p className="text-xs text-blossom-300">{fileError}</p>}
          {analyzeError && <p className="text-xs text-blossom-300">{analyzeError}</p>}
          <button
            type="button"
            disabled={!file || !operatorUserId || analyzing}
            onClick={() => runAnalyze(false)}
            className="min-h-10 w-fit rounded-full bg-ink px-6 text-sm text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint"
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
            <table className="w-full min-w-[480px] text-left text-sm">
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
                      <select
                        value={mapping[col] ?? ""}
                        onChange={(e) => setMapping((prev) => ({ ...prev, [col]: e.target.value || null }))}
                        className="min-h-9 w-full max-w-xs rounded-full border border-cream-200 bg-cream-50 px-3 text-sm text-ink"
                      >
                        <option value="">（不匯入）</option>
                        {targetFields.map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                            {f.required ? "（必填）" : ""}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {analyzeError && <p className="text-xs text-blossom-300">{analyzeError}</p>}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
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
          <div className="flex flex-wrap gap-3 text-xs">
            <StatPill label="總筆數" value={summary.total} />
            <StatPill label="可新增" value={summary.readyToImport} tone="sage" />
            <StatPill label="疑似重複" value={summary.suspectedDuplicate} tone="yolk" />
            <StatPill label="待確認家戶" value={summary.householdUncertain} tone="mist" />
            <StatPill label="資料不完整" value={summary.incompleteData} tone="blossom" />
            <StatPill label="格式錯誤" value={summary.formatError} tone="blossom" />
            <StatPill label="不匯入" value={summary.excluded} />
          </div>
          <p className="text-xs text-ink-faint">以下顯示前 20 筆資料預覽（統計數字為整份檔案）：</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="pb-2 pr-3">列號</th>
                  <th className="pb-2 pr-3">狀態</th>
                  <th className="pb-2 pr-3">姓名</th>
                  <th className="pb-2 pr-3">性別</th>
                  <th className="pb-2 pr-3">國曆生日</th>
                  <th className="pb-2 pr-3">農曆生日</th>
                  <th className="pb-2 pr-3">戶號</th>
                  <th className="pb-2 pr-3">地址</th>
                  <th className="pb-2">錯誤／提醒</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => (
                  <tr key={r.id} className="border-t border-cream-200 align-top">
                    <td className="py-2 pr-3 text-ink-faint">{r.rowNumber}</td>
                    <td className="py-2 pr-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="py-2 pr-3 text-ink">{dash(r.member.name)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{dash(r.member.gender)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{formatDateCell(r.member.solarBirthDate)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{formatLunarCell(r.member)}</td>
                    <td className="py-2 pr-3 text-ink-soft">{dash(r.household.code)}</td>
                    <td className="py-2 pr-3 text-ink-soft max-w-[200px] break-words">{dash(r.household.address)}</td>
                    <td className="py-2 text-ink-faint max-w-[240px] break-words">
                      {[...r.errors, ...r.warnings].join("；") || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
            >
              ← 回欄位對照
            </button>
            <button
              type="button"
              onClick={() => setStep(4)}
              className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50"
            >
              下一步：處理疑似重複／待確認家戶 →
            </button>
          </div>
        </div>
      )}

      {/* ④ 疑似重複／待確認家戶處理 */}
      {step === 4 && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第四步：疑似重複／待確認家戶處理</h3>
          <p className="text-xs text-ink-faint">
            以下列出整份檔案中「疑似重複」與「待確認家戶」的資料（不限前 20 筆）。未處理的列，確認匯入時一律不會寫入。
          </p>
          {refreshing && <p className="text-xs text-ink-faint">重新整理中…</p>}
          {attentionRows.length === 0 ? (
            <p className="text-sm text-ink-faint">目前沒有需要人工處理的資料。</p>
          ) : (
            <div className="flex flex-col gap-3">
              {attentionRows.map((r) => (
                <div key={r.id} className="rounded-2xl border border-cream-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm text-ink">
                      第 {r.rowNumber} 列・{dash(r.member.name)}（戶號 {dash(r.household.code)}）
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE_CLASS[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => openResolvePanel(r)}
                      className="min-h-8 rounded-full border border-cream-200 px-4 text-xs text-ink-soft"
                    >
                      {r.resolution ? "修改決定" : "處理"}
                    </button>
                  </div>
                  {r.groupReason && <p className="mt-2 text-xs text-ink-soft">{r.groupReason}</p>}
                  {r.candidates.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-xs text-ink-soft">
                      {r.candidates.map((c, i) => (
                        <li key={i}>
                          <span className={`mr-1 rounded-full px-2 py-0.5 text-[11px] ${c.tier === "HIGH" ? "bg-yolk-200 text-ink" : "bg-cream-200 text-ink-soft"}`}>
                            {c.tier === "HIGH" ? "高相似度" : "中相似度"}
                          </span>
                          可能與既有「{c.existingHouseholdName}」{c.existingMemberName ? `・${c.existingMemberName}` : ""} 相同：
                          {c.reasons.join("、")}
                        </li>
                      ))}
                    </ul>
                  )}
                  {r.resolution && (
                    <p className="mt-2 text-xs text-ink-soft">
                      目前決定：{RESOLUTION_LABEL[r.resolution.decision]}
                      {r.resolution.householdId ? `（家戶 ${r.resolution.householdId}）` : ""}
                    </p>
                  )}

                  {openResolveRowId === r.id && (
                    <div className="mt-3 flex flex-col gap-3 rounded-2xl bg-cream-50 p-4">
                      <label className="flex flex-col gap-1 text-xs text-ink">
                        處理方式
                        <select
                          value={resolveDecision}
                          onChange={(e) => setResolveDecision(e.target.value as ResolutionDecision)}
                          className="min-h-9 rounded-full border border-cream-200 bg-white px-3 text-sm text-ink"
                        >
                          <option value="SKIP">略過（這次不匯入）</option>
                          <option value="CONFIRMED_NOT_DUPLICATE">確認不是同一人／同一戶（可以新增）</option>
                          <option value="CONFIRMED_DUPLICATE">確認為同一人／同一戶（不匯入）</option>
                          <option value="ASSIGN_HOUSEHOLD">指定歸屬既有家戶</option>
                        </select>
                      </label>
                      {resolveDecision === "ASSIGN_HOUSEHOLD" && (
                        <label className="flex flex-col gap-1 text-xs text-ink">
                          指定家戶編號
                          <input
                            value={resolveHouseholdId}
                            onChange={(e) => setResolveHouseholdId(e.target.value)}
                            className="min-h-9 rounded-full border border-cream-200 bg-white px-3 text-sm text-ink"
                            placeholder="例如 F00009"
                          />
                        </label>
                      )}
                      <label className="flex flex-col gap-1 text-xs text-ink">
                        備註（選填）
                        <input
                          value={resolveNote}
                          onChange={(e) => setResolveNote(e.target.value)}
                          className="min-h-9 rounded-full border border-cream-200 bg-white px-3 text-sm text-ink"
                        />
                      </label>
                      {resolveError && <p className="text-xs text-blossom-300">{resolveError}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={resolveSubmitting}
                          onClick={() => submitResolve(r.id)}
                          className="min-h-9 rounded-full bg-ink px-5 text-xs text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint"
                        >
                          {resolveSubmitting ? "儲存中…" : "儲存決定"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setOpenResolveRowId(null)}
                          className="min-h-9 rounded-full border border-cream-200 px-5 text-xs text-ink-soft"
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
            >
              ← 回預覽
            </button>
            <button
              type="button"
              onClick={async () => {
                await fetchBatchView();
                await loadCommitPreview();
                setStep(5);
              }}
              className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50"
            >
              下一步：確認匯入 →
            </button>
          </div>
        </div>
      )}

      {/* ⑤ 確認匯入 */}
      {step === 5 && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第五步：確認匯入</h3>
          {loadingCommitPreview && <p className="text-xs text-ink-faint">載入中…</p>}
          {commitPreviewError && <p className="text-xs text-blossom-300">{commitPreviewError}</p>}
          {commitPreview && (
            <>
              <div className="flex flex-wrap gap-3 text-xs">
                <StatPill label="即將新增家戶" value={commitPreview.newHouseholdCount} tone="sage" />
                <StatPill label="即將新增信眾" value={commitPreview.newMemberCount} tone="sage" />
                <StatPill label="略過筆數" value={commitPreview.skippedCount} />
                <StatPill label="疑似重複筆數" value={commitPreview.suspectedDuplicateCount} tone="yolk" />
                <StatPill label="錯誤筆數" value={commitPreview.errorCount} tone="blossom" />
              </div>
              {commitPreview.overCap && (
                <p className="rounded-2xl bg-blossom-100 p-4 text-sm text-blossom-300">{commitPreview.capMessage}</p>
              )}
              {!commitPreview.overCap && commitPreview.newMemberCount === 0 && (
                <p className="text-sm text-ink-faint">目前沒有「可新增」且已確認的資料可以匯入。</p>
              )}
              <p className="text-xs text-ink-faint">
                只有狀態為「可新增」的資料會被寫入；疑似重複、待確認家戶、資料不完整、格式錯誤、以及使用者選擇略過的資料，一律不會匯入。
              </p>
              {commitError && <p className="text-xs text-blossom-300">{commitError}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
                >
                  ← 回上一步
                </button>
                <button
                  type="button"
                  disabled={committing || commitPreview.overCap || commitPreview.newMemberCount === 0}
                  onClick={handleCommit}
                  className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50 disabled:bg-cream-200 disabled:text-ink-faint"
                >
                  {committing ? "匯入中，請稍候…" : "確認匯入"}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* ⑥ 匯入結果 */}
      {step === 6 && commitResult && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第六步：匯入結果</h3>
          <div className="flex flex-wrap gap-3 text-xs">
            <StatPill label="新增家戶" value={commitResult.householdsCreated} tone="sage" />
            <StatPill label="新增信眾" value={commitResult.membersCreated} tone="sage" />
            <StatPill label="略過" value={commitResult.skippedCount} />
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
                    第 {f.rowNumber} 列・{dash(f.name)}：{f.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={downloadErrorCsv}
              className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
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
              className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50"
            >
              匯入下一批
            </button>
          </div>
        </div>
      )}

      {step < 6 && operatorUser && (
        <p className="text-xs text-ink-faint">目前操作人員：{operatorUser.name}</p>
      )}
    </div>
  );
}

const RESOLUTION_LABEL: Record<ResolutionDecision, string> = {
  CONFIRMED_DUPLICATE: "確認為同一人／同一戶（不匯入）",
  CONFIRMED_NOT_DUPLICATE: "確認不是同一人／同一戶（可以新增）",
  ASSIGN_HOUSEHOLD: "指定歸屬既有家戶",
  SKIP: "略過（這次不匯入）",
};

function StatPill({ label, value, tone }: { label: string; value: number; tone?: "sage" | "yolk" | "blossom" | "mist" }) {
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
