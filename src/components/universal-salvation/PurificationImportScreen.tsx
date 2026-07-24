"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "@/lib/permissionClient";

/**
 * V14.4 Part 6B：普渡 Excel 匯入 UI（上傳→analyze→可編輯草稿→confirm）。
 * 沿用既有普渡活動年度，不建第二個活動中心。READONLY 無寫入操作（後端亦 403）。
 * 手機/平板：卡片式、大按鈕（min-h-44）、不依賴 hover、錯誤可完整閱讀。
 *
 * V15 UX 驗收：不動匯入核心流程，只改善操作體驗——
 *  1. 每張卡片顯示牌位名稱／陽上人（全部）／牌位地址／家戶編號／配對信眾，
 *     讓工作人員一眼知道是哪一家（同姓多戶時尤其重要）。
 *  2. 全部英文狀態改中文（篩選鈕＋每列徽章）。
 *  3.「明確建立新信眾」→「建立新信眾」。
 *  4. 新增【全部勾選可建立】【全部取消】，避免 100 筆逐筆勾選。
 *  5. 確認區塊顯示「目前已選 XX 筆／確認後建立 XX 筆」。
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

/** 全部狀態英文→中文（篩選鈕、每列徽章、確認狀態共用一份，不散落字面值）。 */
const STATUS_LABEL: Record<string, string> = {
  ALL: "全部",
  MATCHED: "已配對",
  NEW: "新增",
  AMBIGUOUS: "待確認",
  CONFLICT: "衝突",
  INVALID: "無效",
  DUPLICATE: "重複",
  EXCLUDED: "排除",
  // 確認狀態（confirmationStatus）：
  PENDING: "待確認",
  PROCESSING: "確認中",
  CONFIRMED: "已建立",
  FAILED: "失敗",
};

function zh(code: string): string {
  return STATUS_LABEL[code] ?? code;
}

/** 從草稿列（normalizedData + editedData）取出顯示用欄位。 */
function readRow(r: Row) {
  const nd = { ...(r.normalizedData ?? {}), ...(r.editedData ?? {}) } as Record<string, unknown>;
  const yang = Array.isArray(nd.yangshangNames)
    ? (nd.yangshangNames as unknown[]).map((x) => String(x)).filter((x) => x.trim().length > 0)
    : [];
  return {
    tabletName: nd.tabletName != null ? String(nd.tabletName) : "",
    devoteeName: nd.devoteeName != null ? String(nd.devoteeName) : "",
    yangshangNames: yang,
    tabletAddress: nd.tabletAddress != null ? String(nd.tabletAddress) : "",
    householdCode: nd.householdCode != null ? String(nd.householdCode) : "",
    householdName: nd.householdName != null ? String(nd.householdName) : "",
    phone: nd.phone != null ? String(nd.phone) : "",
  };
}

export default function PurificationImportScreen({ year }: { year: number }) {
  const { role, loading } = useCurrentUser();
  const canWrite = !!role && role !== "READONLY";
  const [batch, setBatch] = useState<Batch | null>(null);
  const [filter, setFilter] = useState<Filter>("ALL");
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [bulking, setBulking] = useState(false);
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

  /** 單列更新後不逐列 reload（供批次操作重用）；批次結束再統一 reload 一次。 */
  async function patchRowRaw(rowId: string, body: Record<string, unknown>): Promise<boolean> {
    if (!batch) return false;
    const res = await fetch(`/api/universal-salvation/${year}/import/${batch.id}/rows/${rowId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json().catch(() => null); setError(d?.error ?? "更新失敗"); return false; }
    return true;
  }

  async function patchRow(rowId: string, body: Record<string, unknown>) {
    if (!batch) return;
    if (await patchRowRaw(rowId, body)) await reload(batch.id);
  }

  /**
   * 批次勾選/取消「建立新信眾」：只針對 NEW 且未排除、未建立的列，避免 100 筆逐筆點。
   * 逐列 PATCH（沿用既有單列 API，不新增批次端點），全部送完後只 reload 一次。
   */
  async function bulkSetCreateNew(value: boolean) {
    if (!batch) return;
    setBulking(true); setError(null); setMsg(null);
    const targets = batch.rows.filter(
      (r) => r.matchingStatus === "NEW" && !r.excluded && r.confirmationStatus !== "CONFIRMED" && r.createNewDevoteeConfirmed !== value
    );
    let done = 0;
    for (const r of targets) {
      if (await patchRowRaw(r.id, { createNewDevoteeConfirmed: value })) done++;
    }
    await reload(batch.id);
    setBulking(false);
    setMsg(value ? `已勾選 ${done} 筆為「建立新信眾」。` : `已取消 ${done} 筆勾選。`);
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

  // 確認統計：目前已選＝未排除、未建立的列；確認後建立＝已可確認（resolved）且未排除、未建立。
  const selectedCount = rows.filter((r) => !r.excluded && r.confirmationStatus !== "CONFIRMED").length;
  const willCreateCount = rows.filter((r) => r.resolved && !r.excluded && r.confirmationStatus !== "CONFIRMED").length;
  const newSelectableCount = rows.filter((r) => r.matchingStatus === "NEW" && !r.excluded && r.confirmationStatus !== "CONFIRMED").length;

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
          {/* 2. 欄位辨識 + 3. 預檢摘要（狀態中文化） */}
          <div className="rounded-3xl bg-white/70 p-4 shadow-card">
            <p className="text-xs text-ink-faint">辨識欄位：{Object.entries(batch.detectedColumns ?? {}).map(([f, c]) => `${f}→${c}`).join("、") || "（無）"}</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              {Object.entries(batch.summary ?? {}).map(([k, v]) => {
                // summary key 形如 matchedCount/newCount…；轉成中文狀態名。
                const status = k.replace(/Count$/, "").toUpperCase();
                const label = k === "totalRows" ? "總列數" : k === "confirmableCount" ? "可確認" : (STATUS_LABEL[status] ?? k);
                return <span key={k} className="rounded-full bg-cream-100 px-3 py-1 text-ink-soft">{label}：{v}</span>;
              })}
            </div>
          </div>

          {/* 4. 狀態篩選（中文） */}
          <div className="flex flex-wrap gap-2">
            {STATUSES.map((s) => (
              <button key={s} onClick={() => setFilter(s)} className={`${btn} ${filter === s ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>{zh(s)}</button>
            ))}
          </div>

          {/* 批次操作：全部勾選可建立 / 全部取消（只影響 NEW 未排除列） */}
          {canWrite && newSelectableCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-mist-50 px-4 py-3">
              <span className="text-xs text-ink-soft">可建立新信眾的列：{newSelectableCount} 筆</span>
              <button onClick={() => void bulkSetCreateNew(true)} disabled={bulking} className={`${btn} bg-sage-200 text-ink`}>
                {bulking ? "處理中…" : "全部勾選可建立"}
              </button>
              <button onClick={() => void bulkSetCreateNew(false)} disabled={bulking} className={`${btn} bg-cream-100 text-ink-soft`}>
                全部取消
              </button>
            </div>
          )}

          {/* 5. 每列編輯（卡片式，顯示完整辨識資訊） */}
          <div className="flex flex-col gap-2">
            {shown.map((r) => {
              const d = readRow(r);
              return (
                <div key={r.id} className={`rounded-2xl p-3 shadow-soft ${r.excluded ? "bg-cream-200/50" : "bg-white/70"}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-ink">#{r.rowNumber}｜{d.tabletName || d.devoteeName || "（未填牌位姓名）"}</span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${r.confirmationStatus === "CONFIRMED" ? "bg-sage-200" : r.confirmationStatus === "FAILED" ? "bg-blossom-200" : "bg-mist-100"} text-ink-soft`}>
                      {zh(r.matchingStatus)}{r.confirmationStatus !== "PENDING" ? `／${zh(r.confirmationStatus)}` : ""}
                    </span>
                  </div>

                  {/* 完整辨識資訊：讓工作人員一眼知道是哪一家 */}
                  <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-ink-soft sm:grid-cols-2">
                    {d.yangshangNames.length > 0 && (
                      <div><span className="text-ink-faint">陽上人：</span>{d.yangshangNames.join("、")}</div>
                    )}
                    {d.tabletAddress && (
                      <div><span className="text-ink-faint">牌位地址：</span>{d.tabletAddress}</div>
                    )}
                    {(d.householdCode || d.householdName) && (
                      <div><span className="text-ink-faint">家戶：</span>{d.householdCode}{d.householdCode && d.householdName ? "・" : ""}{d.householdName}</div>
                    )}
                    {r.matchedDevoteeId && d.devoteeName && (
                      <div><span className="text-ink-faint">配對信眾：</span>{d.devoteeName}{d.phone ? `（${d.phone}）` : ""}</div>
                    )}
                    {!r.matchedDevoteeId && d.devoteeName && (
                      <div><span className="text-ink-faint">報名信眾：</span>{d.devoteeName}{d.phone ? `（${d.phone}）` : ""}</div>
                    )}
                  </dl>

                  {r.issueMessages && r.issueMessages.length > 0 && <p className="mt-1 text-xs text-ink-faint">依據/問題：{r.issueMessages.join("；")}</p>}
                  {r.errorMessage && <p className="mt-1 text-xs text-blossom-500">錯誤：{r.errorMessage}</p>}
                  {canWrite && r.confirmationStatus !== "CONFIRMED" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
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
                          建立新信眾
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

          {/* 確認區塊：目前已選 / 確認後建立（confirmationKey 防連點） */}
          {canWrite && (
            <div className="sticky bottom-0 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-3xl bg-white/90 p-4 shadow-card backdrop-blur">
              <div className="flex flex-col">
                <span className="text-xs text-ink-faint">目前已選</span>
                <span className="text-lg text-ink">{selectedCount} 筆</span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-ink-faint">確認後建立</span>
                <span className="text-lg text-ink">{willCreateCount} 筆</span>
              </div>
              <button onClick={confirm} disabled={confirming || batch.status === "CONFIRMED" || willCreateCount === 0} className={`${btn} bg-blossom-200 text-ink`}>
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
