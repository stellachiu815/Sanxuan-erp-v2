"use client";

import { useState } from "react";
import Link from "next/link";
import { useOperator } from "@/lib/operatorClient";

/**
 * V11.3「信眾資料匯入預檢中心」正式版——五步驟精靈（依正式 7 欄 Excel 格式）：
 *   ① 上傳檔案 → ② 欄位對照 → ③ 預覽與統計 → ④ 確認匯入 → ⑤ 匯入結果
 *
 * ⚠️ 舊版有一個「④ 疑似重複／待確認家戶處理」的人工判斷步驟，正式版已經
 * 移除——正式格式一列＝一戶、家戶編號是唯一鍵，家戶用「編號是否已存在」
 * 判斷要新增還是更新，家戶成員／歷代祖先／乙位正魂用「姓名是否已存在」
 * 判斷要不要新增，兩者都是確認匯入當下就能百分之百決定的事，不再有需要
 * 人工判斷「這是不是同一人／同一戶」的模糊地帶。
 */

type ClientHouseholdFields = {
  code: string;
  name: string;
  contactName: string | null;
  address: string | null;
};

type RowStatus = "READY_TO_IMPORT" | "INCOMPLETE_DATA" | "FORMAT_ERROR" | "EXCLUDED" | "IMPORTED";

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
};

type Summary = {
  total: number;
  readyToImport: number;
  incompleteData: number;
  formatError: number;
  excluded: number;
  imported: number;
};

type TargetField = { key: string; label: string; required?: boolean };

type CommitPreview = {
  newHouseholdCount: number;
  updateHouseholdCount: number;
  newMemberCount: number;
  newAncestorCount: number;
  newSpiritCount: number;
  skippedCount: number;
  overCap: boolean;
  capMessage: string | null;
};

type CommitResult = {
  householdsCreated: number;
  householdsUpdated: number;
  membersCreated: number;
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
};

// ⚠️ 顏色僅使用 tailwind.config.ts 實際定義的色階（yolk/blossom/mist/sage
// 只到 300，ink 只有 DEFAULT/soft/faint，沒有數字色階）。
const STATUS_BADGE_CLASS: Record<RowStatus, string> = {
  READY_TO_IMPORT: "bg-sage-200 text-ink",
  INCOMPLETE_DATA: "bg-blossom-200 text-ink",
  FORMAT_ERROR: "bg-blossom-200 text-ink",
  EXCLUDED: "bg-cream-200 text-ink-faint",
  IMPORTED: "bg-sage-200 text-ink",
};

const dash = (v: string | null | undefined): string => (v && v.trim().length > 0 ? v : "—");

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
      setStep(5);
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
            正式格式固定七欄：家戶編號｜戶名｜主要聯絡人｜地址｜歷代祖先｜乙位正魂｜家戶成員，一列代表一戶。
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
            <StatPill label="總筆數（戶）" value={summary.total} />
            <StatPill label="可匯入" value={summary.readyToImport} tone="sage" />
            <StatPill label="資料不完整" value={summary.incompleteData} tone="blossom" />
            <StatPill label="格式錯誤" value={summary.formatError} tone="blossom" />
          </div>
          <p className="text-xs text-ink-faint">以下顯示前 20 筆資料預覽（統計數字為整份檔案，每一筆代表一戶）：</p>
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
                  {dash(r.household.contactName)} / 家庭成員：{r.memberNames.length}人 / 祖先：
                  {r.ancestorNames.length}筆 / 乙位正魂：{r.spiritNames.length}筆
                </p>
                {r.household.address && <p className="mt-1 text-xs text-ink-soft">地址：{r.household.address}</p>}
                {r.memberNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">家戶成員：{r.memberNames.join("、")}</p>
                )}
                {r.ancestorNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">歷代祖先：{r.ancestorNames.join("、")}</p>
                )}
                {r.spiritNames.length > 0 && (
                  <p className="mt-1 text-xs text-ink-soft">乙位正魂：{r.spiritNames.join("、")}</p>
                )}
                {(r.errors.length > 0 || r.warnings.length > 0) && (
                  <p className="mt-2 text-xs text-blossom-300">{[...r.errors, ...r.warnings].join("；")}</p>
                )}
              </div>
            ))}
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
              onClick={async () => {
                setStep(4);
                await loadCommitPreview();
              }}
              className="min-h-10 rounded-full bg-ink px-6 text-sm text-cream-50"
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
              <div className="flex flex-wrap gap-3 text-xs">
                <StatPill label="即將新增家戶" value={commitPreview.newHouseholdCount} tone="sage" />
                <StatPill label="即將更新家戶" value={commitPreview.updateHouseholdCount} tone="mist" />
                <StatPill label="即將新增成員" value={commitPreview.newMemberCount} tone="sage" />
                <StatPill label="即將新增祖先" value={commitPreview.newAncestorCount} tone="sage" />
                <StatPill label="即將新增乙位正魂" value={commitPreview.newSpiritCount} tone="sage" />
                <StatPill label="不處理筆數" value={commitPreview.skippedCount} tone="blossom" />
              </div>
              {commitPreview.overCap && (
                <p className="rounded-2xl bg-blossom-100 p-4 text-sm text-blossom-300">{commitPreview.capMessage}</p>
              )}
              <p className="text-xs text-ink-faint">
                只有狀態為「可匯入」的家戶會被處理；資料不完整、格式錯誤的列一律不會匯入。已經存在的家戶成員／歷代祖先／乙位正魂會保留原樣，不會被覆蓋或刪除，只會新增找不到的資料。
              </p>
              {commitError && <p className="text-xs text-blossom-300">{commitError}</p>}
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => setStep(3)}
                  className="min-h-10 rounded-full border border-cream-200 px-6 text-sm text-ink-soft"
                >
                  ← 回上一步
                </button>
                <button
                  type="button"
                  disabled={committing || commitPreview.overCap}
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

      {/* ⑤ 匯入結果 */}
      {step === 5 && commitResult && (
        <div className="flex flex-col gap-4 rounded-3xl bg-white/70 p-6 shadow-card">
          <h3 className="text-sm text-ink">第五步：匯入結果</h3>
          <div className="flex flex-wrap gap-3 text-xs">
            <StatPill label="新增家戶" value={commitResult.householdsCreated} tone="sage" />
            <StatPill label="更新家戶" value={commitResult.householdsUpdated} tone="mist" />
            <StatPill label="新增成員" value={commitResult.membersCreated} tone="sage" />
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

      {step < 5 && operatorUser && (
        <p className="text-xs text-ink-faint">目前操作人員：{operatorUser.name}</p>
      )}
    </div>
  );
}

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
