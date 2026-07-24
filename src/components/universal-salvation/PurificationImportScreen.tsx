"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/permissionClient";

/**
 * V14.4 Part 6B：普渡 Excel 匯入 UI（上傳→analyze→可編輯草稿→confirm）。
 * 沿用既有普渡活動年度，不建第二個活動中心。READONLY 無寫入操作（後端亦 403）。
 * 手機/平板：卡片式、大按鈕（min-h-44）、不依賴 hover、錯誤可完整閱讀。
 */

type Row = {
  id: string;
  rowNumber: number;
  matchingStatus: string;
  matchedDevoteeId: string | null;
  matchedHouseholdId: string | null;
  candidateIds: string[] | null;
  issueMessages: string[] | null;
  excluded: boolean;
  resolved: boolean;
  createNewDevoteeConfirmed: boolean;
  confirmationStatus: string;
  confirmedRecordId: string | null;
  errorMessage: string | null;
  normalizedData: Record<string, unknown>;
  editedData: Record<string, unknown> | null;
};

type Batch = { id: string; year: number; status: string; detectedColumns: Record<string, string> | null; summary: Record<string, number> | null; rows: Row[] };

const STATUSES = ["ALL", "MATCHED", "NEW", "AMBIGUOUS", "CONFLICT", "INVALID", "DUPLICATE", "EXCLUDED"] as const;
type Filter = (typeof STATUSES)[number];

export default function PurificationImportScreen({ year }: { year: number }) {
  const { role, loading } = useCurrentUser();
  const canWrite = !!role && role !== "READONLY";
  const [batch, setBatch] = useState<Batch | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const reload = useCallback(async (batchId: string) => {
    const res = await fetch(`/api/universal-salvation/${year}/import/${batchId}`);
    const data = await res.json().catch(() => null);
    if (res.ok) setBatch(data.batch);
  }, [year]);

  useEffect(() => { if (batch?.id) void reload(batch.id); /* eslint-disable-next-line */ }, []);

  async function upload(file: File) {
    setUploading(true); setError(null); setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/universal-salvation/${year}/import/analyze`, { method: "POST", body: fd });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "解析失敗");
      await reload(data.batchId);
      setMsg(`已解析 ${data.totalRows} 列：可確認 ${data.confirmableCount}，待處理 ${(data.ambiguousCount ?? 0) + (data.conflictCount ?? 0) + (data.invalidCount ?? 0)}。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失敗");
    } finally { setUploading(false); }
  }

  async function patchRow(rowId: string, body: Record<string, unknown>) {
    if (!batch) return;
    const res = await fetch(`/api/universal-salvation/${year}/import/${batch.id}/rows/${rowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (res.ok) await reload(batch.id);
    else { const d = await res.json().catch(() => null); setError(d?.error ?? "更新失敗"); }
  }

  async function confirm() {
    if (!batch) return;
    setConfirming(true); setError(null); setMsg(null);
    const confirmationKey = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${batch.id}-${Date.now()}`;
    try {
      const res = await fetch(`/api/universal-salvation/${year}/import/${batch.id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmationKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "確認失敗");
      const ok = (data.results ?? []).filter((r: { ok: boolean }) => r.ok).length;
      const fail = (data.results ?? []).length - ok;
      setMsg(data.deduplicated ? "此批次先前已確認（重送已忽略）。" : `確認完成：成功 ${ok} 列、失敗 ${fail} 列。`);
      await reload(batch.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "確認失敗");
    } finally { setConfirming(false); }
  }

  if (loading) return <p className="p-4 text-sm text-ink-faint">載入中…</p>;

  const btn = "rounded-full px-4 py-2 text-sm min-h-[44px] disabled:opacity-40";
  const rows = batch?.rows ?? [];
  const shown = rows.filter((r) => filter === "ALL" ? true : filter === "EXCLUDED" ? r.excluded : r.matchingStatus === filter && !r.excluded);

  return (
    <div className="flex flex-col gap-4">
      {/* 1. 上傳 */}
      <div className="rounded-3xl bg-white/70 p-4 shadow-card">
        <h3 className="text-sm font-medium text-ink">從 Excel 匯入普渡報名</h3>
        <p className="mt-1 text-xs text-ink-faint">上傳後只建立可編輯草稿，不會直接寫入正式報名；逐列確認後才正式建立。</p>
        {canWrite ? (
          <input type="file" accept=".xlsx,.xls,.csv" disabled={uploading}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
            className="mt-3 block w-full text-sm min-h-[44px]" />
        ) : <p className="mt-2 text-xs text-blossom-500">您目前為唯讀權限，無法匯入。</p>}
        {msg && <p className="mt-2 text-xs text-sage-500">{msg}</p>}
        {error && <p className="mt-2 text-xs text-blossom-500">⚠️ {error}</p>}
      </div>

      {batch && (
        <>
          {/* 2. 欄位辨識 + 3. 預檢摘要 */}
          <div className="rounded-3xl bg-white/70 p-4 shadow-card">
            <p className="text-xs text-ink-faint">辨識欄位：{Object.entries(batch.detectedColumns ?? {}).map(([f, c]) => `${f}→${c}`).join("、") || "（無）"}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {Object.entries(batch.summary ?? {}).map(([k, v]) => <span key={k} className="rounded-full bg-cream-100 px-3 py-1 text-ink-soft">{k}: {v}</span>)}
            </div>
          </div>

          {/* 4. 狀態篩選 */}
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setFilter(s)} className={`${btn} ${filter === s ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>{s}</button>
            ))}
          </div>

          {/* 5. 每列編輯（卡片式） */}
          <div className="flex flex-col gap-2">
            {shown.map((r) => {
              const nd = { ...(r.normalizedData ?? {}), ...(r.editedData ?? {}) } as Record<string, unknown>;
              return (
                <div key={r.id} className={`rounded-2xl p-3 shadow-soft ${r.excluded ? "bg-cream-200/50" : "bg-white/70"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm text-ink">#{r.rowNumber}｜{String(nd.tabletName ?? nd.devoteeName ?? "")}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.confirmationStatus === "CONFIRMED" ? "bg-sage-200" : r.confirmationStatus === "FAILED" ? "bg-blossom-200" : "bg-mist-100"} text-ink-soft`}>
                      {r.matchingStatus}{r.confirmationStatus !== "PENDING" ? `／${r.confirmationStatus}` : ""}
                    </span>
                  </div>
                  {r.issueMessages && r.issueMessages.length > 0 && <p className="mt-1 text-xs text-ink-faint">依據/問題：{r.issueMessages.join("；")}</p>}
                  {r.errorMessage && <p className="mt-1 text-xs text-blossom-500">錯誤：{r.errorMessage}</p>}
                  {canWrite && r.confirmationStatus !== "CONFIRMED" && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.candidateIds && r.candidateIds.length > 0 && (
                        <select value={r.matchedDevoteeId ?? ""} onChange={(e) => patchRow(r.id, { matchedDevoteeId: e.target.value || null })}
                          className="rounded-lg border border-cream-200 px-2 py-1 text-xs min-h-[40px]">
                          <option value="">選擇正確信眾…</option>
                          {r.candidateIds.map((c) => <option key={c} value={c}>{c}</option>)}
                        </select>
                      )}
                      {r.matchingStatus === "NEW" && (
                        <label className="flex items-center gap-1 text-xs text-ink-soft">
                          <input type="checkbox" className="h-5 w-5" checked={r.createNewDevoteeConfirmed} onChange={(e) => patchRow(r.id, { createNewDevoteeConfirmed: e.target.checked })} />
                          明確建立新信眾
                        </label>
                      )}
                      <button onClick={() => patchRow(r.id, { excluded: !r.excluded })} className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft min-h-[40px]">
                        {r.excluded ? "恢復此列" : "排除此列"}
                      </button>
                      {r.resolved && !r.excluded && <span className="text-xs text-sage-500">✓ 可確認</span>}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="p-4 text-center text-sm text-ink-faint">沒有符合條件的列。</p>}
          </div>

          {/* 10/11. 確認（confirmationKey 防連點） */}
          {canWrite && (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-3 rounded-3xl bg-white/90 p-4 shadow-card backdrop-blur">
              <span className="text-sm text-ink-soft">可確認 {rows.filter((r) => r.resolved && !r.excluded && r.confirmationStatus !== "CONFIRMED").length} 列</span>
              <button onClick={confirm} disabled={confirming || batch.status === "CONFIRMED"} className={`${btn} bg-blossom-200 text-ink`}>
                {confirming ? "確認中…" : "確認並正式建立"}
              </button>
              {batch.status === "CONFIRMED" && <span className="text-xs text-sage-500">此批次已全部確認完成。</span>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
