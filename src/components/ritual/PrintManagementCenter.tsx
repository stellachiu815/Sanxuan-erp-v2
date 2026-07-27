"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V15R8：普渡列印管理「唯一入口」。所有來源（手動／信眾頁／家戶多人／活動頁／Excel 匯入／
 * 沿用去年）建立的都是 RitualRegistrationItem，一律由此彙整。分頁：
 *   A. 報名名單（全部／依項目／依家戶／依信眾）——本元件。
 *   B. 實體列印物件（牌位／寶袋）——連結到既有列印物件中心（不合併資料表、不重寫）。
 * 只列正式可列印（CONFIRMED）；Excel 草稿須先經報名確認流程才會出現。
 */

type Item = {
  registrationItemId: string;
  year: number;
  itemKey: string;
  itemName: string;
  householdId: string;
  householdName: string;
  memberName: string | null;
  tabletName: string | null;
  yangshangNames: string[];
  tabletAddress: string | null;
  source: string;
  sourceLabel: string;
  quantity: number;
  printCount: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  lastPrintedByName: string | null;
};

const SOURCE_OPTIONS = [
  { value: "", label: "全部來源" },
  { value: "DEVOTEE_PAGE", label: "信眾頁報名" },
  { value: "HOUSEHOLD_PAGE", label: "家戶報名" },
  { value: "ACTIVITY_PAGE", label: "活動頁報名" },
  { value: "EXCEL_IMPORT", label: "Excel 匯入" },
  { value: "CARRY_OVER", label: "沿用去年" },
];
const STATUS_OPTIONS = [
  { value: "ALL", label: "全部狀態" },
  { value: "UNPRINTED", label: "未列印" },
  { value: "PRINTED", label: "已列印" },
];
type GroupBy = "ALL" | "ITEM" | "HOUSEHOLD" | "MEMBER";

function fmt(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear() - 1911}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function statusText(it: Item): string {
  if (it.printCount === 0) return "未列印";
  if (it.printCount === 1) return "已列印";
  return `補印 ${it.printCount - 1} 次`;
}

export default function PrintManagementCenter() {
  const currentYear = new Date().getFullYear() - 1911;
  const [year, setYear] = useState(currentYear);
  const [itemKey, setItemKey] = useState("");
  const [source, setSource] = useState("");
  const [printStatus, setPrintStatus] = useState("ALL");
  const [q, setQ] = useState("");
  const [groupBy, setGroupBy] = useState<GroupBy>("ALL");
  const [items, setItems] = useState<Item[] | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setItems(null);
    setSelected({});
    try {
      const params = new URLSearchParams({ year: String(year), printStatus });
      if (itemKey) params.set("itemKey", itemKey);
      if (source) params.set("source", source);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetchRegistration(`/api/print-center/items?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setItems(data.items ?? []);
      setError(null);
    } catch {
      setError("讀取列印名單時發生連線問題。");
    }
  }, [year, itemKey, source, printStatus, q]);

  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [year, itemKey, source, printStatus]);

  // 報名項目下拉：由目前結果的相異項目動態組成（涵蓋實際存在的 8 類）。
  const itemOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items ?? []) m.set(it.itemKey, it.itemName);
    return [{ key: "", name: "全部項目" }, ...[...m.entries()].map(([key, name]) => ({ key, name }))];
  }, [items]);

  async function print(ids: string[]) {
    if (ids.length === 0) return;
    setBusy(true); setError(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/print-center/items/print`, { method: "POST", body: JSON.stringify({ ids }) });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setMsg(`已列印 ${data.printed} 筆（首次設定首印時間，補印累加次數，收款/金額不變）。`);
      await load();
    } catch { setError("列印時發生連線問題。"); } finally { setBusy(false); }
  }

  async function printAll() {
    setBusy(true); setError(null); setMsg(null);
    try {
      const filter = { year, itemKey: itemKey || null, source: source || null, printStatus, q: q.trim() || null };
      const res = await fetchRegistration(`/api/print-center/items/print`, { method: "POST", body: JSON.stringify({ all: true, filter }) });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setMsg(`已依目前篩選全部列印 ${data.printed} 筆。`);
      await load();
    } catch { setError("列印時發生連線問題。"); } finally { setBusy(false); }
  }

  const selectedIds = Object.keys(selected).filter((k) => selected[k]);
  const rows = items ?? [];

  // 依 groupBy 分組（全部＝單組）。
  const groups = useMemo(() => {
    if (groupBy === "ALL") return [["全部名單", rows] as [string, Item[]]];
    const keyOf = (it: Item) => groupBy === "ITEM" ? it.itemName : groupBy === "HOUSEHOLD" ? `${it.householdName}（${it.householdId}）` : (it.memberName ?? "（未指定信眾）");
    const m = new Map<string, Item[]>();
    for (const it of rows) { const k = keyOf(it); (m.get(k) ?? m.set(k, []).get(k)!).push(it); }
    return [...m.entries()];
  }, [rows, groupBy]);

  return (
    <div className="flex flex-col gap-4">
      {/* 搜尋與篩選 */}
      <div className="rounded-3xl bg-white/70 p-4 shadow-card">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-ink-soft">年度
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="mt-1 block w-24 rounded-lg border border-cream-200 px-2 py-1.5 text-sm" />
          </label>
          <label className="text-xs text-ink-soft">報名項目
            <select value={itemKey} onChange={(e) => setItemKey(e.target.value)} className="mt-1 block w-40 rounded-lg border border-cream-200 px-2 py-1.5 text-sm">
              {itemOptions.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-soft">資料來源
            <select value={source} onChange={(e) => setSource(e.target.value)} className="mt-1 block w-36 rounded-lg border border-cream-200 px-2 py-1.5 text-sm">
              {SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-xs text-ink-soft">列印狀態
            <select value={printStatus} onChange={(e) => setPrintStatus(e.target.value)} className="mt-1 block w-32 rounded-lg border border-cream-200 px-2 py-1.5 text-sm">
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="flex-1 text-xs text-ink-soft">搜尋（家戶／信眾／牌位姓名／陽上人／地址）
            <div className="mt-1 flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void load(); }} placeholder="輸入關鍵字後按 Enter" className="min-h-9 flex-1 rounded-lg border border-cream-200 px-3 py-1.5 text-sm" />
              <button type="button" onClick={() => void load()} className="rounded-full bg-mist-200 px-4 text-sm text-ink">搜尋</button>
            </div>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-ink-faint">名單檢視：</span>
          {(["ALL", "ITEM", "HOUSEHOLD", "MEMBER"] as GroupBy[]).map((g) => (
            <button key={g} onClick={() => setGroupBy(g)} className={`rounded-full px-3 py-1 ${groupBy === g ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft"}`}>
              {g === "ALL" ? "全部" : g === "ITEM" ? "依項目" : g === "HOUSEHOLD" ? "依家戶" : "依信眾"}
            </button>
          ))}
          <Link href={`/universal-salvation/${year}/print-center`} className="ml-auto rounded-full bg-sage-100 px-3 py-1 text-ink hover:bg-sage-200">
            → 實體列印物件（牌位／寶袋）
          </Link>
        </div>
      </div>

      {msg && <p className="rounded-2xl bg-sage-100 px-4 py-2 text-sm text-ink">{msg}</p>}
      {error && <p className="text-sm text-blossom-500">⚠️ {error}</p>}

      {/* 操作列 */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-3 rounded-2xl bg-white/90 px-4 py-3 shadow-card backdrop-blur">
        <span className="text-sm text-ink">共 {rows.length} 筆</span>
        <span className="text-xs text-ink-faint">已選 {selectedIds.length} 筆</span>
        <button type="button" onClick={() => void print(selectedIds)} disabled={busy || selectedIds.length === 0} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">列印選取（批次）</button>
        <button type="button" onClick={() => void printAll()} disabled={busy || rows.length === 0} className="rounded-full bg-blossom-200 px-4 py-1.5 text-sm text-ink disabled:opacity-40">全部列印（目前篩選 {rows.length} 筆）</button>
      </div>

      {/* 名單 */}
      {items === null ? <p className="p-4 text-center text-sm text-ink-faint">讀取中…</p> : rows.length === 0 ? (
        <p className="p-4 text-center text-sm text-ink-faint">沒有符合條件的可列印資料。</p>
      ) : (
        groups.map(([groupName, groupRows]) => (
          <div key={groupName} className="rounded-3xl bg-white/70 p-4 shadow-card">
            {groupBy !== "ALL" && <h3 className="mb-2 text-sm font-medium text-ink">{groupName}（{groupRows.length} 筆）</h3>}
            <ul className="divide-y divide-cream-200">
              {groupRows.map((it) => (
                <li key={it.registrationItemId} className="flex flex-wrap items-start gap-3 py-2.5">
                  <input type="checkbox" className="mt-1 h-5 w-5" checked={!!selected[it.registrationItemId]} onChange={(e) => setSelected((p) => ({ ...p, [it.registrationItemId]: e.target.checked }))} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                      <span className="font-medium">{it.tabletName || it.memberName || "（未填牌位姓名）"}</span>
                      <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">{it.itemName}</span>
                      <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft">{it.sourceLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${it.printCount === 0 ? "bg-yolk-100 text-ink" : "bg-sage-100 text-ink"}`}>{statusText(it)}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-faint">
                      {it.householdName}（{it.householdId}）
                      {it.memberName ? `・報名人：${it.memberName}` : ""}
                      {it.yangshangNames.length > 0 ? `・陽上：${it.yangshangNames.join("、")}` : ""}
                      {it.tabletAddress ? `・地址：${it.tabletAddress}` : ""}
                    </div>
                    {it.printCount > 0 && (
                      <div className="mt-0.5 text-xs text-ink-faint">首次：{fmt(it.firstPrintedAt)}　最後：{fmt(it.lastPrintedAt)}　操作人：{it.lastPrintedByName ?? "—"}</div>
                    )}
                  </div>
                  <button type="button" onClick={() => void print([it.registrationItemId])} disabled={busy} className="rounded-full bg-cream-100 px-3 py-1 text-xs text-ink-soft hover:bg-mist-100 disabled:opacity-40">
                    {it.printCount === 0 ? "列印" : "補印"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </div>
  );
}
