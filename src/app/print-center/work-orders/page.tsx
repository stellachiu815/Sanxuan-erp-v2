"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import { renumberByCurrentSort, type WorkOrderRow as WORow } from "@/lib/workOrder";

/**
 * V32 列印管理 → 中元普渡 → 正式作業編號管理（正式可操作 UI）。
 * 依項目切換、搜尋、上下移動、直接輸入號碼、依目前排序重編、依原始 registrationOrder 產生初始號碼、
 * 鎖定/解除、儲存（transaction、重號後端擋）。已列印改號顯示需重新列印。儲存後即時刷新。
 *
 * 本頁為**獨立全域管理頁**：無任何 route param（不需 Household/Member/TempleEvent ID），
 * 直接開 /print-center/work-orders 即可進入。資料一律由頁內以 fetch 呼叫 API 取得（年度由頁內選）。
 * force-dynamic：不做建置期靜態預渲染（此為需登入的動態管理頁），避免建置期預渲染造成部署失敗。
 */
export const dynamic = "force-dynamic";

type Row = {
  id: string; registrationOrder: number | null; workOrder: number | null;
  itemKey: string; itemName: string; subject: string; household: string; yangshang: string;
  status: string; printCount: number; printedAt: string | null;
};

export default function WorkOrderAdminPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner />
      </div>
    </OperatorProvider>
  );
}

function Inner() {
  const currentYear = new Date().getFullYear() - 1911;
  const [year, setYear] = useState(currentYear === 0 ? 115 : currentYear);
  const [itemTypes, setItemTypes] = useState<{ key: string; name: string }[]>([]);
  const [itemKey, setItemKey] = useState("US_ANCESTOR");
  const [rows, setRows] = useState<Row[]>([]);
  const [orig, setOrig] = useState<Map<string, number | null>>(new Map());
  const [locked, setLocked] = useState(false);
  const [q, setQ] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 項目清單（活動啟用的普渡 RegistrationItemType）。
  useEffect(() => {
    (async () => {
      try {
        const res = await fetchRegistration(`/api/print-center/activity-items?year=${year}`);
        const d = await res.json();
        if (res.ok) setItemTypes((d.summary ?? []).filter((s: { activityGroup: string }) => s.activityGroup === "UNIVERSAL_SALVATION").map((s: { itemKey: string; itemName: string }) => ({ key: s.itemKey, name: s.itemName })));
      } catch { /* 保留現況 */ }
    })();
  }, [year]);

  const load = useCallback(async () => {
    setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders?itemKey=${itemKey}`);
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setRows(d.rows); setLocked(d.locked);
      setOrig(new Map((d.rows as Row[]).map((r) => [r.id, r.workOrder])));
    } catch { setErr("讀取失敗"); }
  }, [year, itemKey]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = q.trim();
    return rows.filter((r) => !nq || r.subject.includes(nq) || r.household.includes(nq) || r.yangshang.includes(nq) || String(r.workOrder ?? "").includes(nq));
  }, [rows, q]);

  const move = (idx: number, dir: -1 | 1) => {
    const next = [...rows];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRows(next);
  };
  const setWo = (id: string, v: string) => {
    const n = v.trim() === "" ? null : Number(v);
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, workOrder: Number.isFinite(n as number) ? (n as number) : null } : r)));
  };
  const renumber = () => {
    const active = rows.filter((r) => r.status !== "CANCELLED");
    const out = renumberByCurrentSort(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })));
    const m = new Map(out.map((o) => [o.id, o.workOrder]));
    setRows((rs) => rs.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r)));
    setMsg("已依目前排序重編（尚未儲存）。");
  };
  const proposeInitial = async () => {
    const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders?itemKey=${itemKey}`, { method: "PUT" });
    const d = await res.json();
    if (!res.ok) { setErr(d?.error ?? "產生失敗"); return; }
    const m = new Map((d.proposed as { id: string; workOrder: number }[]).map((p) => [p.id, p.workOrder]));
    setRows((rs) => rs.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r)));
    setMsg(`已依原始報名順序產生 ${m.size} 筆初始號碼（尚未儲存，已有號者不覆蓋）。`);
  };

  const changedPrinted = rows.filter((r) => r.printCount > 0 && r.workOrder !== (orig.get(r.id) ?? null));

  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const updates = rows.filter((r) => r.workOrder !== (orig.get(r.id) ?? null)).map((r) => ({ id: r.id, workOrder: r.workOrder }));
      const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders`, { method: "POST", body: JSON.stringify({ itemKey, updates }) });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? "儲存失敗"); return; }
      setRows(d.rows); setLocked(d.locked);
      setOrig(new Map((d.rows as Row[]).map((r) => [r.id, r.workOrder])));
      setMsg("已儲存並刷新。");
    } catch { setErr("儲存失敗"); } finally { setBusy(false); }
  };
  const toggleLock = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders`, { method: "POST", body: JSON.stringify({ itemKey, updates: [], lock: !locked }) });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? "鎖定失敗"); return; }
      setLocked(d.locked); setMsg(d.locked ? "已鎖定。" : "已解除鎖定。");
    } catch { setErr("鎖定失敗"); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-3 text-lg text-ink">列印管理・中元普渡・正式作業編號管理</h1>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label>年度 <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="w-20 rounded border border-cream-300 px-2 py-1" /></label>
        <label>項目
          <select value={itemKey} onChange={(e) => setItemKey(e.target.value)} className="ml-1 rounded border border-cream-300 px-2 py-1">
            {itemTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 姓名/家戶/陽上/號碼" className="rounded border border-cream-300 px-2 py-1" />
        <button onClick={proposeInitial} disabled={busy || locked} className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40">依原始順序產生初始號碼</button>
        <button onClick={renumber} disabled={busy || locked} className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40">依目前排序重新編號</button>
        <button onClick={() => void load()} disabled={busy} className="rounded-full bg-cream-100 px-3 py-1">恢復原始順序</button>
        <button onClick={() => void save()} disabled={busy || locked} className="rounded-full bg-yolk-200 px-4 py-1 disabled:opacity-40">儲存</button>
        <button onClick={() => void toggleLock()} disabled={busy} className={`rounded-full px-3 py-1 ${locked ? "bg-rose-200" : "bg-sage-100"}`}>{locked ? "🔒 已鎖定（點此解除）" : "🔓 鎖定"}</button>
      </div>
      {locked && <p className="mb-2 text-xs text-rose-600">已鎖定：Excel／牌位／寶袋使用已鎖定號碼；需先解除才能修改，新增資料排最後不重排既有號。</p>}
      {changedPrinted.length > 0 && <p className="mb-2 text-xs text-amber-700">⚠ 有 {changedPrinted.length} 筆曾列印且號碼已變更，儲存後需重新列印。</p>}
      {msg && <p className="mb-2 text-xs text-sage-700">{msg}</p>}
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white/70 p-3 shadow-card">
        <table className="w-full text-left text-xs">
          <thead><tr className="text-ink-faint">
            <th className="px-2 py-1">移動</th><th className="px-2 py-1">原始序(registrationOrder)</th><th className="px-2 py-1">正式作業號(workOrder)</th>
            <th className="px-2 py-1">名稱</th><th className="px-2 py-1">家戶</th><th className="px-2 py-1">陽上</th><th className="px-2 py-1">報名狀態</th><th className="px-2 py-1">列印</th>
          </tr></thead>
          <tbody>
            {filtered.map((r, i) => {
              const realIdx = rows.findIndex((x) => x.id === r.id);
              return (
                <tr key={r.id} className={`border-t border-cream-200 ${r.status === "CANCELLED" ? "opacity-50" : ""}`}>
                  <td className="px-2 py-1">
                    <button onClick={() => move(realIdx, -1)} disabled={locked} className="px-1">▲</button>
                    <button onClick={() => move(realIdx, 1)} disabled={locked} className="px-1">▼</button>
                  </td>
                  <td className="px-2 py-1 text-ink-faint">{r.registrationOrder ?? "—"}</td>
                  <td className="px-2 py-1">
                    <input value={r.workOrder ?? ""} onChange={(e) => setWo(r.id, e.target.value)} disabled={locked || r.status === "CANCELLED"} className="w-16 rounded border border-cream-300 px-1 py-0.5" />
                  </td>
                  <td className="px-2 py-1 text-ink">{r.subject}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.household}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.yangshang || "—"}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.status === "CANCELLED" ? "已取消(歷史)" : r.status}</td>
                  <td className="px-2 py-1 text-ink-faint">{r.printCount > 0 ? `已印×${r.printCount}` : "未印"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-faint">＊儲存採 transaction；同項目重號會整批 rollback 並顯示原因。取消資料顯示於此為歷史、不占用新號。</p>
    </main>
  );
}
