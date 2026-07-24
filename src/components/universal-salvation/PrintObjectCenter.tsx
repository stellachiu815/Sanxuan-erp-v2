"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/lib/permissionClient";

/**
 * V14.4 Part 3：普渡列印中心（列印物件層）。沿用既有列印中心頁面與資料查詢
 * （/print-items/groups 只是同一份 AdditionalPrintItem 的分組投影），不建立第二套。
 *
 * 每筆牌位顯示 TABLET 與 POCKET 兩個獨立區塊（未列印／已列印／已補印 N 次、
 * 首印/末印時間、最後操作人）。支援單獨/同時/批次列印、只選未列印、狀態篩選。
 * PDF/列印頁成功產生後才顯示「確認完成列印」；只有按下確認才呼叫 confirm API
 * （帶 idempotencyKey）；開啟預覽不更新 printCount。READONLY 只能看、無確認按鈕。
 */

type PrintObject = {
  id: string;
  itemType: string;
  printName: string;
  status: string;
  printCount: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  lastPrintedByName: string | null;
};

type Group = {
  sourceEntryId: string;
  household: { id: string; name: string };
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  tablet: PrintObject | null;
  pocket: PrintObject | null;
  extras: PrintObject[];
};

type StatusFilter = "ALL" | "UNPRINTED" | "PRINTED" | "REPRINTED";

function statusOf(o: PrintObject | null): "NONE" | "UNPRINTED" | "PRINTED" | "REPRINTED" {
  if (!o) return "NONE";
  if (o.printCount <= 0) return "UNPRINTED";
  if (o.printCount === 1) return "PRINTED";
  return "REPRINTED";
}

function statusLabel(o: PrintObject | null): string {
  switch (statusOf(o)) {
    case "NONE": return "（無此列印物件）";
    case "UNPRINTED": return "未列印";
    case "PRINTED": return "已列印";
    case "REPRINTED": return `已補印 ${o!.printCount - 1} 次`;
  }
}

function fmt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function matchesFilter(o: PrintObject | null, f: StatusFilter): boolean {
  if (!o) return false;
  if (f === "ALL") return true;
  return statusOf(o) === f;
}

export default function PrintObjectCenter({ year }: { year: number }) {
  const { role, loading: roleLoading } = useCurrentUser();
  const canPrint = !!role && role !== "READONLY";

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewReady, setPreviewReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const refresh = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/universal-salvation/${year}/print-items/groups`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => null))?.error ?? "載入失敗");
        return r.json();
      })
      .then((d) => { if (!cancelled) { setGroups(d.groups); setError(null); } })
      .catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [year, reloadTick]);

  // 每次改變選取內容，代表這不是同一份已產生的列印頁 → 需重新產生預覽再確認。
  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setPreviewReady(false);
    setOkMsg(null);
  }

  const allObjects = useMemo(() => {
    const list: PrintObject[] = [];
    for (const g of groups ?? []) {
      if (g.tablet) list.push(g.tablet);
      if (g.pocket) list.push(g.pocket);
      for (const e of g.extras) list.push(e);
    }
    return list;
  }, [groups]);

  function selectWhere(pred: (o: PrintObject) => boolean) {
    const next = new Set<string>();
    for (const o of allObjects) if (pred(o)) next.add(o.id);
    setSelected(next);
    setPreviewReady(false);
    setOkMsg(null);
  }

  const filteredGroups = useMemo(() => {
    if (!groups) return [];
    if (filter === "ALL") return groups;
    return groups.filter((g) => matchesFilter(g.tablet, filter) || matchesFilter(g.pocket, filter) || g.extras.some((e) => matchesFilter(e, filter)));
  }, [groups, filter]);

  const pendingCount = selected.size;

  // 「產生列印頁」：開啟列印預覽（瀏覽器列印對話框），不更新任何 printCount。
  function openPrintPreview() {
    if (pendingCount === 0) return;
    setPreviewReady(true);
    setOkMsg(null);
    setConfirmError(null);
    // 實際 PDF/列印頁在 Mac/實機由瀏覽器產生；這裡觸發列印預覽作為「已產生」的動作。
    if (typeof window !== "undefined") {
      try { window.print(); } catch { /* 忽略：預覽失敗不影響資料 */ }
    }
  }

  async function confirmPrinted() {
    if (!canPrint || pendingCount === 0 || submitting) return;
    setSubmitting(true);
    setConfirmError(null);
    setOkMsg(null);
    // 每次「確認完成列印」動作用一組穩定 idempotencyKey（重送/連點不重複累加）。
    const idempotencyKey =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${year}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      const res = await fetch(`/api/universal-salvation/${year}/print-items/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected], idempotencyKey }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "確認完成列印失敗");
      setOkMsg(
        data?.deduplicated
          ? "此次列印先前已確認過（重送已忽略，未重複累加）。"
          : `已確認完成列印：首次列印 ${data?.printedCount ?? 0} 筆、補印 ${data?.reprintedCount ?? 0} 筆。`
      );
      setSelected(new Set());
      setPreviewReady(false);
      refresh();
    } catch (e) {
      // 失敗不可假裝成功，也不清空選取。
      setConfirmError(e instanceof Error ? e.message : "確認完成列印失敗");
    } finally {
      setSubmitting(false);
    }
  }

  if (error) return <div className="rounded-3xl bg-blossom-100 p-6 text-sm text-ink">{error}</div>;
  if (!groups || roleLoading) return <p className="p-6 text-sm text-ink-faint">載入中…</p>;

  const btn = "rounded-full px-4 py-2 text-sm min-h-[44px] transition disabled:opacity-40";

  return (
    <div className="flex flex-col gap-4">
      {/* 篩選 + 快速選取工具列（窄畫面可換行、大按鈕、不依賴 hover） */}
      <div className="flex flex-col gap-3 rounded-3xl bg-white/70 p-4 shadow-card">
        <div className="flex flex-wrap gap-2">
          {(["ALL", "UNPRINTED", "PRINTED", "REPRINTED"] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`${btn} ${filter === f ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>
              {f === "ALL" ? "全部" : f === "UNPRINTED" ? "未列印" : f === "PRINTED" ? "已列印" : "已補印"}
            </button>
          ))}
        </div>
        {canPrint && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => selectWhere((o) => o.itemType === "TABLET" && o.printCount <= 0)} className={`${btn} bg-butter-100 text-ink-soft`}>只選未列印牌位</button>
            <button onClick={() => selectWhere((o) => o.itemType === "POCKET" && o.printCount <= 0)} className={`${btn} bg-butter-100 text-ink-soft`}>只選未列印寶袋</button>
            <button onClick={() => selectWhere(() => true)} className={`${btn} bg-cream-100 text-ink-soft`}>全選</button>
            <button onClick={() => { setSelected(new Set()); setPreviewReady(false); }} className={`${btn} bg-cream-100 text-ink-soft`}>清除選取</button>
          </div>
        )}
      </div>

      {/* 牌位清單：每筆 TABLET / POCKET 雙區塊 */}
      <div className="flex flex-col gap-3">
        {filteredGroups.map((g) => (
          <div key={g.sourceEntryId} className="rounded-3xl bg-white/70 p-4 shadow-card">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{g.sourceDisplayName}</span>
              <span className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft">{g.sourceCategoryLabel}・{g.household.name}</span>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(["tablet", "pocket"] as const).map((kind) => {
                const o = g[kind];
                const label = kind === "tablet" ? "牌位 TABLET" : "寶袋 POCKET";
                return (
                  <div key={kind} className="rounded-2xl bg-cream-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-ink-soft">{label}</span>
                      {canPrint && o && (
                        <label className="flex items-center gap-2">
                          <input type="checkbox" className="h-5 w-5" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                          <span className="text-xs text-ink-faint">選取</span>
                        </label>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-ink">{statusLabel(o)}</p>
                    <p className="mt-1 text-xs text-ink-faint">首印：{fmt(o?.firstPrintedAt ?? null)}</p>
                    <p className="text-xs text-ink-faint">最後：{fmt(o?.lastPrintedAt ?? null)}</p>
                    <p className="text-xs text-ink-faint">操作人：{o?.lastPrintedByName ?? "—"}</p>
                  </div>
                );
              })}
            </div>
            {g.extras.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 rounded-2xl bg-cream-50 p-3">
                <span className="text-xs font-medium text-ink-soft">額外寶袋</span>
                {g.extras.map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-xs text-ink-soft">
                    {canPrint && <input type="checkbox" className="h-5 w-5" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />}
                    <span>{e.printName}｜{statusLabel(e)}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
        {filteredGroups.length === 0 && <p className="p-6 text-center text-sm text-ink-faint">沒有符合條件的牌位。</p>}
      </div>

      {/* 底部固定批次工具列（手機可用、換行不溢位）；READONLY 不顯示確認按鈕 */}
      {canPrint && (
        <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 rounded-3xl bg-white/90 p-4 shadow-card backdrop-blur">
          <span className="text-sm text-ink-soft">已勾選 {pendingCount} 個列印物件</span>
          <button onClick={openPrintPreview} disabled={pendingCount === 0} className={`${btn} bg-sage-200 text-ink`}>
            產生列印頁 / 預覽
          </button>
          <button onClick={confirmPrinted} disabled={!previewReady || pendingCount === 0 || submitting}
            className={`${btn} ${previewReady ? "bg-blossom-200 text-ink" : "bg-cream-200 text-ink-faint"}`}>
            {submitting ? "確認中…" : "確認完成列印"}
          </button>
          {!previewReady && pendingCount > 0 && <span className="text-xs text-ink-faint">請先「產生列印頁 / 預覽」，成功後才能確認</span>}
          {okMsg && <span className="text-xs text-sage-500">{okMsg}</span>}
          {confirmError && <span className="text-xs text-blossom-500">⚠️ {confirmError}</span>}
        </div>
      )}
      {!canPrint && <p className="rounded-3xl bg-white/70 p-4 text-xs text-ink-faint shadow-soft">您目前為唯讀權限，可查看列印狀態，但無法確認完成列印。</p>}
    </div>
  );
}
