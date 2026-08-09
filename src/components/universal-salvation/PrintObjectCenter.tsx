"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCurrentUser } from "@/lib/permissionClient";
import IncompletePreviewBanner from "./IncompletePreviewBanner";

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
  /** V32 §5 需補印狀態（首次列印後內容又被修改）。 */
  needsReprint: boolean;
  /** V32 §5 搜尋用：正式作業號。 */
  registrationOrder: number | null;
  /** V32 §5 搜尋用：牌位主文覆寫。 */
  printMainText: string | null;
};

type Group = {
  sourceEntryId: string;
  household: { id: string; name: string };
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  tablet: PrintObject | null;
  pocket: PrintObject | null;
  extras: PrintObject[];
  /** V36.4：完整度缺漏欄位（沿用完整度 gate 結果；空陣列＝完整）。 */
  tabletMissingFields: string[];
};

type StatusFilter = "ALL" | "UNPRINTED" | "PRINTED" | "REPRINT_NEEDED" | "INCOMPLETE";

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
  if (f === "REPRINT_NEEDED") return o.needsReprint;
  const s = statusOf(o); // NONE/UNPRINTED/PRINTED/REPRINTED
  if (f === "UNPRINTED") return s === "UNPRINTED";
  if (f === "PRINTED") return s === "PRINTED" || s === "REPRINTED";
  return false;
}

/** V32 §5 搜尋：workOrder（作業號）／姓名／牌位主文／家戶。空字串＝全部通過。 */
function matchesSearch(o: PrintObject, groupName: string, householdName: string, q: string): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  const hay = [
    o.registrationOrder != null ? String(o.registrationOrder) : "",
    o.registrationOrder != null ? `no.${o.registrationOrder}` : "",
    o.printName ?? "",
    o.printMainText ?? "",
    groupName,
    householdName,
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(term);
}

export default function PrintObjectCenter({ year }: { year: number }) {
  const { role, loading: roleLoading } = useCurrentUser();
  const canPrint = !!role && role !== "READONLY";

  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewReady, setPreviewReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [incompleteMissing, setIncompleteMissing] = useState<string[]>([]);
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
    return groups.filter((g) => {
      const objs = [g.tablet, g.pocket, ...g.extras].filter((o): o is PrintObject => !!o);
      // V36.4：「資料不完整」是牌位（來源）層屬性，用完整度 gate 的 tabletMissingFields 判斷。
      const passFilter =
        filter === "ALL"
          ? true
          : filter === "INCOMPLETE"
            ? g.tabletMissingFields.length > 0
            : objs.some((o) => matchesFilter(o, filter));
      const passSearch = !search.trim() || objs.some((o) => matchesSearch(o, g.sourceDisplayName, g.household.name, search));
      return passFilter && passSearch;
    });
  }, [groups, filter, search]);

  // V32 §5：清單層需補印總數（供工具列提示）。
  const reprintNeededCount = useMemo(
    () => allObjects.filter((o) => o.needsReprint).length,
    [allObjects]
  );

  // V36.4：資料不完整牌位數（沿用完整度 gate 結果，不重算）。
  const incompleteCount = useMemo(
    () => (groups ?? []).filter((g) => g.tabletMissingFields.length > 0).length,
    [groups]
  );

  const pendingCount = selected.size;

  // 「產生列印頁 / 預覽」：**導向牌位專用列印頁**（只顯示 A4 牌位），
  // **絕不**在本管理頁執行 window.print()（否則會印出整個管理介面，即先前 18 頁問題）。
  function openPrintPreview() {
    if (pendingCount === 0 || typeof window === "undefined") return;
    setOkMsg(null);
    setConfirmError(null);

    // 收集勾選中的牌位（TABLET）與寶袋（POCKET）id；牌位再依原祭祀類別推出批次（祖先/乙位 vs 冤親）。
    const tabletIds: string[] = [];
    const pocketIds: string[] = []; // V30.3：寶袋改為正式 A4 版面，支援勾選 ids 列印。
    const batches = new Set<string>();
    for (const g of groups ?? []) {
      for (const o of [g.tablet, g.pocket, ...g.extras]) {
        if (!o || !selected.has(o.id)) continue;
        if (o.itemType === "TABLET") {
          tabletIds.push(o.id);
          batches.add(g.sourceCategoryLabel.includes("冤親") ? "creditor" : "ancestor-soul");
        } else {
          pocketIds.push(o.id);
        }
      }
    }

    if (tabletIds.length === 0 && pocketIds.length === 0) {
      setConfirmError("目前沒有勾選任何可列印物件。");
      return;
    }
    // 牌位（黃色紙）與寶袋（紅色紙）為不同批次，需分開列印。
    if (tabletIds.length > 0 && pocketIds.length > 0) {
      setConfirmError("牌位與寶袋為不同批次（黃色紙／紅色紙），請分開列印：一次只選牌位或只選寶袋。");
      return;
    }

    // V30.3：寶袋批次（依 registrationOrder 排序、支援作業號碼開關）——開啟寶袋正式 A4 列印頁。
    if (pocketIds.length > 0) {
      const rel = `/universal-salvation/${year}/print-center/print?batch=pocket&ids=${pocketIds.join(",")}`;
      const url = new URL(rel, window.location.origin).href;
      setPreviewReady(true);
      const win = window.open(url, "_blank", "noopener");
      if (!win) window.location.assign(url);
      return;
    }

    if (batches.size > 1) {
      setConfirmError("不同列印批次需分開列印，請一次只選同一批：祖先／乙位正魂 或 累世冤親債主。");
      return;
    }

    const batch = [...batches][0];
    const rel = `/universal-salvation/${year}/print-center/print?batch=${batch}&ids=${tabletIds.join(",")}`;
    const url = new URL(rel, window.location.origin).href; // 絕對網址
    setPreviewReady(true); // 已產生列印頁 → 之後可「確認完成列印」
    // 優先新分頁（保留本管理頁的勾選與確認狀態）；被彈窗封鎖時**同分頁導向專用列印頁**，
    // 絕不改成在本管理頁 window.print()。
    const win = window.open(url, "_blank", "noopener");
    if (!win) window.location.assign(url);
  }

  // 共用：呼叫「確認完成列印」後端（printCount+1）。confirmPrinted 與
  // markAsPrinted 都走這個同一支已驗證的後端，不改任何列印核心邏輯。
  async function doConfirm(successMsg?: (data: { deduplicated?: boolean; printedCount?: number; reprintedCount?: number } | null) => string) {
    setSubmitting(true);
    setConfirmError(null);
    setOkMsg(null);
    // 每次動作用一組穩定 idempotencyKey（重送/連點不重複累加）。
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
      if (res.status === 422 && data?.code === "INCOMPLETE_DATA") {
        // 資料不完整：後端已擋、未寫任何列印狀態。顯示缺項提示，不視為成功。
        const fields: string[] = Array.isArray(data?.missingFields) ? data.missingFields : [];
        setIncompleteMissing(fields);
        setConfirmError(`${data?.message ?? "資料尚未完整"}：${fields.map((f) => `缺${f}`).join("、")}`);
        return;
      }
      if (!res.ok) throw new Error(data?.error ?? "更新列印狀態失敗");
      setIncompleteMissing([]);
      setOkMsg(
        successMsg
          ? successMsg(data)
          : data?.deduplicated
            ? "此次列印先前已確認過（重送已忽略，未重複累加）。"
            : `已確認完成列印：首次列印 ${data?.printedCount ?? 0} 筆、補印 ${data?.reprintedCount ?? 0} 筆。`
      );
      setSelected(new Set());
      setPreviewReady(false);
      refresh();
    } catch (e) {
      // 失敗不可假裝成功，也不清空選取。
      setConfirmError(e instanceof Error ? e.message : "更新列印狀態失敗");
    } finally {
      setSubmitting(false);
    }
  }

  async function confirmPrinted() {
    if (!canPrint || pendingCount === 0 || submitting) return;
    await doConfirm();
  }

  // 「標記為已列印（不重印）」：把勾選的物件直接記為已列印（printCount+1），
  // 用於「今天已經印過、但當時沒按確認」的補登記——之後批次列印會自動跳過它們。
  // 走的是同一支確認後端，不會實際列印、也不改核心邏輯。
  async function markAsPrinted() {
    if (!canPrint || pendingCount === 0 || submitting) return;
    if (!window.confirm(`確定把勾選的 ${pendingCount} 個標記為「已列印」嗎？\n\n這不會實際列印，只是把它們登記為已印，之後的批次列印（一鍵列印全部未列印）會自動跳過它們。`)) return;
    await doConfirm((data) =>
      data?.deduplicated
        ? "先前已登記過（重送已忽略）。"
        : `已標記為已列印：${(data?.printedCount ?? 0) + (data?.reprintedCount ?? 0)} 個（未實際重印）。`
    );
  }

  // 「重設為未列印」：把勾選的物件退回未列印（取消列印登記），用於手滑標錯時。
  // 只動列印狀態、不動收款/內容。
  async function resetSelected() {
    if (!canPrint || pendingCount === 0 || submitting) return;
    if (!window.confirm(`確定把勾選的 ${pendingCount} 個「重設為未列印」嗎？\n\n它們會退回未列印、重新進入批次列印。只會取消列印登記，不影響收款與內容。`)) return;
    setSubmitting(true);
    setConfirmError(null);
    setOkMsg(null);
    try {
      const res = await fetch(`/api/universal-salvation/${year}/print-items/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [...selected] }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? "重設失敗");
      setOkMsg(`已重設為未列印：${data?.reset ?? 0} 個。`);
      setSelected(new Set());
      setPreviewReady(false);
      refresh();
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : "重設失敗");
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
          {(["ALL", "UNPRINTED", "PRINTED", "REPRINT_NEEDED", "INCOMPLETE"] as StatusFilter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`${btn} ${filter === f ? "bg-ink-soft text-cream-50" : f === "INCOMPLETE" && incompleteCount > 0 ? "bg-blossom-100 text-blossom-500" : "bg-cream-100 text-ink-soft"}`}>
              {f === "ALL" ? "全部" : f === "UNPRINTED" ? "未列印" : f === "PRINTED" ? "已列印"
                : f === "REPRINT_NEEDED" ? `需要補印${reprintNeededCount > 0 ? `（${reprintNeededCount}）` : ""}`
                : `資料不完整${incompleteCount > 0 ? `（${incompleteCount}）` : ""}`}
            </button>
          ))}
        </div>
        {/* V32 §5 補印搜尋：作業號／姓名／牌位主文／家戶 */}
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜尋：作業號（No.xxx／數字）、姓名、牌位主文、家戶名稱…"
          className="w-full rounded-full border border-cream-200 bg-white px-4 py-2 text-sm text-ink placeholder:text-ink-faint"
        />
        {canPrint && (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => selectWhere((o) => o.itemType === "TABLET" && o.printCount <= 0)} className={`${btn} bg-butter-100 text-ink-soft`}>只選未列印牌位</button>
            <button onClick={() => selectWhere((o) => o.itemType === "POCKET" && o.printCount <= 0)} className={`${btn} bg-butter-100 text-ink-soft`}>只選未列印寶袋</button>
            <button onClick={() => selectWhere((o) => o.needsReprint)} className={`${btn} bg-amber-100 text-amber-700`}>只選需補印</button>
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
              <span className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink">{g.sourceDisplayName}</span>
                {/* V36.4：直接顯示完整度 gate 結果——完整／資料不完整（列出缺漏欄位）。 */}
                {g.tabletMissingFields.length === 0 ? (
                  <span className="rounded-full bg-sage-100 px-2 py-0.5 text-xs text-ink-soft">完整</span>
                ) : (
                  <span className="rounded-full bg-blossom-100 px-2 py-0.5 text-xs font-medium text-blossom-500">
                    資料不完整（缺：{g.tabletMissingFields.join("、")}）
                  </span>
                )}
              </span>
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
                    <p className="mt-1 text-sm text-ink">
                      {statusLabel(o)}
                      {o?.needsReprint && (
                        <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700">需要補印</span>
                      )}
                    </p>
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
                    {e.needsReprint && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700">需要補印</span>}
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
          <button onClick={markAsPrinted} disabled={pendingCount === 0 || submitting}
            className={`${btn} bg-butter-100 text-ink-soft`}
            title="今天已經印過、但當時沒按確認的，勾選後用這顆補登記為已列印，之後批次列印會自動跳過">
            {submitting ? "處理中…" : "標記為已列印（不重印）"}
          </button>
          <button onClick={resetSelected} disabled={pendingCount === 0 || submitting}
            className={`${btn} bg-cream-200 text-ink-soft`}
            title="手滑標錯時用這顆：把勾選的退回未列印、重新進入批次列印（不影響收款與內容）">
            {submitting ? "處理中…" : "重設為未列印"}
          </button>
          {!previewReady && pendingCount > 0 && <span className="text-xs text-ink-faint">要實際列印請先「產生列印頁 / 預覽」；已印過的可直接按「標記為已列印」</span>}
          {okMsg && <span className="text-xs text-sage-500">{okMsg}</span>}
          {confirmError && <span className="text-xs text-blossom-500">⚠️ {confirmError}</span>}
          {incompleteMissing.length > 0 && (
            <div className="w-full"><IncompletePreviewBanner missingFields={incompleteMissing} /></div>
          )}
        </div>
      )}
      {!canPrint && <p className="rounded-3xl bg-white/70 p-4 text-xs text-ink-faint shadow-soft">您目前為唯讀權限，可查看列印狀態，但無法確認完成列印。</p>}
    </div>
  );
}
