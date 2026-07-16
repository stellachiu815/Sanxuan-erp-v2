"use client";

import { useEffect, useMemo, useState } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import {
  additionalPrintItemTypeLabel,
  additionalPrintItemStatusLabel,
  additionalPrintItemStatusOptions,
  universalSalvationEntryCategoryLabel,
  universalSalvationEntryCategoryOrder,
} from "@/lib/labels";
import { summarizePrintItems, type AdditionalPrintItemStatusValue } from "@/lib/additionalPrintItemRules";

type PrintCenterItem = {
  id: string;
  household: { id: string; name: string };
  sourceCategory: string;
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  itemType: string;
  printName: string;
  quantity: number;
  isExtra: boolean;
  status: AdditionalPrintItemStatusValue;
  isPrinted: boolean;
  printedQuantity: number;
  note: string | null;
};

type Props = { year: number };

const ROW_STATUS_LABEL: Record<string, string> = {
  NEW: "新增",
  DUPLICATE: "重複",
  MISSING_DATA: "缺少資料",
  NEEDS_CONFIRMATION: "待確認（找不到來源資料）",
};

/**
 * V9.1「普渡列印中心」（需求「九」）：跨家戶依年度查詢/篩選附加列印項目
 * （寶袋等），可分開查看預設寶袋／額外寶袋／全部寶袋，支援全部列印／只印
 * 預設寶袋／只印額外寶袋／指定寶袋補印／指定家戶列印／指定名稱搜尋，並
 * 提供 Excel/CSV 匯入（方式二：明細工作表）。
 */
export default function PrintItemsCenter({ year }: Props) {
  const [items, setItems] = useState<PrintCenterItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [householdId, setHouseholdId] = useState("");
  const [registrantName, setRegistrantName] = useState("");
  const [sourceCategory, setSourceCategory] = useState("");
  const [sourceName, setSourceName] = useState("");
  const [printName, setPrintName] = useState("");
  const [extraFilter, setExtraFilter] = useState<"" | "true" | "false">("");
  const [statusFilter, setStatusFilter] = useState("");

  async function load() {
    setLoadError(null);
    try {
      const query = new URLSearchParams();
      if (householdId.trim()) query.set("householdId", householdId.trim());
      if (registrantName.trim()) query.set("registrantName", registrantName.trim());
      if (sourceCategory) query.set("sourceCategory", sourceCategory);
      if (sourceName.trim()) query.set("sourceName", sourceName.trim());
      if (printName.trim()) query.set("printName", printName.trim());
      if (extraFilter) query.set("isExtra", extraFilter);
      if (statusFilter) query.set("status", statusFilter);

      const res = await fetch(`/api/universal-salvation/${year}/print-items?${query.toString()}`);
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "讀取失敗，請稍後再試一次。");
        return;
      }
      setItems(data.items);
      setSelected(new Set());
    } catch {
      setLoadError("網路錯誤，請稍後再試一次。");
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const summary = useMemo(() => summarizePrintItems(items ?? []), [items]);

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!items) return;
    setSelected((prev) => (prev.size === items.length ? new Set() : new Set(items.map((i) => i.id))));
  }

  async function runPrintBatch(filter: Record<string, unknown>) {
    setBusy(true);
    setActionError(null);
    setToast(null);
    try {
      const res = await fetch(`/api/universal-salvation/${year}/print-items/print-batches`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "列印失敗，請稍後再試一次。");
        return;
      }
      setToast(`已產生列印批次：新列印 ${data.printedCount} 筆，補印 ${data.reprintedCount} 筆`);
      await load();
    } catch {
      setActionError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">預設 {summary.defaultCount}</span>
        <span className="rounded-full bg-blossom-100 px-3 py-1 text-xs text-ink-soft">額外 {summary.extraCount}</span>
        <span className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft">總數 {summary.total}</span>
        <span className="rounded-full bg-yolk-100 px-3 py-1 text-xs text-ink-soft">待列印 {summary.pendingPrintCount}</span>
        <span className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink-soft">已列印 {summary.printedCount}</span>
        <span className="rounded-full bg-white/70 px-3 py-1 text-xs text-ink-faint">已取消 {summary.cancelledCount}</span>
      </div>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm font-medium text-ink">篩選</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={labelClass}>家戶編號</label>
            <input className={inputClass} value={householdId} onChange={(e) => setHouseholdId(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>報名人</label>
            <input className={inputClass} value={registrantName} onChange={(e) => setRegistrantName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>原祭祀類型</label>
            <select className={inputClass} value={sourceCategory} onChange={(e) => setSourceCategory(e.target.value)}>
              <option value="">（全部）</option>
              {universalSalvationEntryCategoryOrder.map((c) => (
                <option key={c} value={c}>
                  {universalSalvationEntryCategoryLabel[c]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>原祭祀名稱</label>
            <input className={inputClass} value={sourceName} onChange={(e) => setSourceName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>寶袋列印名稱</label>
            <input className={inputClass} value={printName} onChange={(e) => setPrintName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>預設／額外</label>
            <select
              className={inputClass}
              value={extraFilter}
              onChange={(e) => setExtraFilter(e.target.value as "" | "true" | "false")}
            >
              <option value="">（全部）</option>
              <option value="false">預設</option>
              <option value="true">額外</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>狀態</label>
            <select className={inputClass} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">（全部）</option>
              {additionalPrintItemStatusOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <button type="button" className={primaryButtonClass} onClick={load}>
            套用篩選
          </button>
        </div>
      </section>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-medium text-ink">批次列印</h2>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={secondaryButtonClass} onClick={() => runPrintBatch({ kind: "ALL" })} disabled={busy}>
              全部列印
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => runPrintBatch({ kind: "DEFAULT_ONLY" })}
              disabled={busy}
            >
              只印預設寶袋
            </button>
            <button
              type="button"
              className={secondaryButtonClass}
              onClick={() => runPrintBatch({ kind: "EXTRA_ONLY" })}
              disabled={busy}
            >
              只印額外寶袋
            </button>
            <button
              type="button"
              className={primaryButtonClass}
              onClick={() => runPrintBatch({ kind: "IDS", ids: [...selected] })}
              disabled={busy || selected.size === 0}
            >
              {busy ? "處理中…" : `列印勾選項目（${selected.size}）`}
            </button>
          </div>
        </div>
        {actionError && <p className={`mt-3 ${errorTextClass}`}>{actionError}</p>}
        {toast && <p className="mt-3 text-sm text-sage-700">{toast}</p>}
        <p className="mt-2 text-xs text-ink-faint">
          ⚠️ 本輪僅完成資料格式與列印批次紀錄，沙盒環境無法產生真正的 PDF 檔案，之後接上正式模板／PDF 引擎即可。
        </p>
      </section>

      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-ink">項目清單</h2>
          {items && items.length > 0 && (
            <button type="button" className="text-xs text-ink-soft hover:underline" onClick={toggleSelectAll}>
              {selected.size === items.length ? "取消全選" : "全選"}
            </button>
          )}
        </div>

        {loadError && <p className={`mt-3 ${errorTextClass}`}>{loadError}</p>}

        <div className="mt-3 max-h-[32rem] overflow-y-auto rounded-xl border border-cream-200">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-cream-100">
              <tr className="text-ink-faint">
                <th className="px-3 py-2"></th>
                <th className="px-3 py-2">家戶</th>
                <th className="px-3 py-2">原祭祀類型／名稱</th>
                <th className="px-3 py-2">項目</th>
                <th className="px-3 py-2">列印名稱</th>
                <th className="px-3 py-2">數量</th>
                <th className="px-3 py-2">預設／額外</th>
                <th className="px-3 py-2">狀態</th>
              </tr>
            </thead>
            <tbody>
              {items?.map((item) => (
                <tr key={item.id} className="border-t border-cream-100">
                  <td className="px-3 py-2">
                    <input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleSelected(item.id)} />
                  </td>
                  <td className="px-3 py-2">{item.household.name}（{item.household.id}）</td>
                  <td className="px-3 py-2">
                    {item.sourceCategoryLabel}／{item.sourceDisplayName}
                  </td>
                  <td className="px-3 py-2">{additionalPrintItemTypeLabel[item.itemType] ?? item.itemType}</td>
                  <td className="px-3 py-2">{item.printName}</td>
                  <td className="px-3 py-2">{item.quantity}</td>
                  <td className="px-3 py-2">{item.isExtra ? "額外" : "預設"}</td>
                  <td className="px-3 py-2">
                    {additionalPrintItemStatusLabel[item.status] ?? item.status}
                    {item.isPrinted && `（已印 ${item.printedQuantity}/${item.quantity}）`}
                  </td>
                </tr>
              ))}
              {items?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-ink-faint">
                    沒有符合條件的項目。
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <ImportPanel year={year} onImported={load} />
    </div>
  );
}

type TargetField = { key: string; label: string; required?: boolean };
type AnalyzedRow = { rowNumber: number; mapped: Record<string, unknown>; status: string; issues: string[] };

function ImportPanel({ year, onImported }: { year: number; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [targetFields, setTargetFields] = useState<TargetField[]>([]);
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [rows, setRows] = useState<AnalyzedRow[]>([]);
  const [summary, setSummary] = useState<Record<string, number> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  async function handleAnalyze() {
    if (!file) {
      setError("請先選擇檔案");
      return;
    }
    setError(null);
    setResult(null);
    setAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch(`/api/universal-salvation/${year}/print-items/import/analyze`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "分析失敗");
        return;
      }
      setTargetFields(data.targetFields);
      setMapping(data.mapping);
      setRows(data.rows);
      setSummary(data.summary);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setAnalyzing(false);
    }
  }

  async function handleCommit() {
    if (!file) return;
    setCommitting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("mapping", JSON.stringify(mapping));
      const res = await fetch(`/api/universal-salvation/${year}/print-items/import/commit`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "匯入失敗");
        return;
      }
      setResult(`已匯入 ${data.importedCount} 筆，略過 ${data.skippedCount} 筆${data.errors.length ? `，${data.errors.length} 筆發生錯誤` : ""}`);
      setFile(null);
      setRows([]);
      setSummary(null);
      onImported();
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm font-medium text-ink">Excel／CSV 匯入附加列印項目（明細工作表）</h2>
      <p className="mt-1 text-xs text-ink-soft">
        欄位：家戶編號／報名人／原祭祀類型／原祭祀名稱／附加項目類型／列印名稱／數量／預設或額外／備註。
        找不到對應來源祭祀資料的列，會列入「待確認」，不會直接匯入。
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setRows([]);
            setSummary(null);
            setResult(null);
          }}
        />
        <button
          type="button"
          className={secondaryButtonClass + " border border-cream-300"}
          onClick={handleAnalyze}
          disabled={analyzing || !file}
        >
          {analyzing ? "分析中…" : "產生分析預覽"}
        </button>
      </div>

      {error && <p className={`mt-3 ${errorTextClass}`}>{error}</p>}
      {result && <p className="mt-3 text-sm text-sage-700">{result}</p>}

      {summary && (
        <div className="mt-3 flex flex-wrap gap-3 text-sm text-ink-soft">
          <span className="rounded-full bg-sage-100 px-3 py-1 text-xs">新增 {summary.new}</span>
          <span className="rounded-full bg-cream-200 px-3 py-1 text-xs">重複 {summary.duplicate}</span>
          <span className="rounded-full bg-blossom-100 px-3 py-1 text-xs">缺少資料 {summary.missingData}</span>
          <span className="rounded-full bg-yolk-100 px-3 py-1 text-xs">待確認 {summary.needsConfirmation}</span>
        </div>
      )}

      {targetFields.length > 0 && rows.length > 0 && (
        <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-cream-200">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-cream-200 text-ink-faint">
                <th className="px-3 py-2">列</th>
                <th className="px-3 py-2">狀態</th>
                <th className="px-3 py-2">說明</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.rowNumber} className="border-b border-cream-100 last:border-0">
                  <td className="px-3 py-2">{r.rowNumber}</td>
                  <td className="px-3 py-2">{ROW_STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="px-3 py-2 text-ink-faint">{r.issues.join("；") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rows.length > 0 && (
        <div className="mt-3 flex justify-end">
          <button type="button" className={primaryButtonClass} onClick={handleCommit} disabled={committing}>
            {committing ? "匯入中…" : "確認匯入"}
          </button>
        </div>
      )}
    </section>
  );
}
