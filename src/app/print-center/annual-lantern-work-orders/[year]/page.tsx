"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { use } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import { renumberByCurrentSort, autoAssignWorkOrders, moveToPosition, type WorkOrderRow as WORow } from "@/lib/workOrder";

/**
 * V41 列印管理 → 年度燈 → 正式作業編號管理（照燈別各自 1..N）。
 * 規則與普渡的作業號頁一致：自動帶號、上下移、移到第 N 號、依目前排序重編、儲存（兩階段、重號後端擋）。
 * 差異：年度燈是本人點燈（無陽上人）、無鎖定；資料由燈別（光明／太歲／祭改／全家）切換。
 */
export const dynamic = "force-dynamic";

const LAMPS = [
  { key: "LANTERN_GUANGMING", label: "光明燈" },
  { key: "LANTERN_TAISUI", label: "太歲燈" },
  { key: "LANTERN_PURIFICATION", label: "祭改" },
  { key: "LANTERN_FAMILY", label: "全家燈" },
];

type Row = {
  id: string; registrationOrder: number | null; workOrder: number | null;
  itemKey: string; itemName: string; subject: string; household: string;
  status: string; printCount: number; printedAt: string | null;
};

export default function AnnualLanternWorkOrderPage({ params }: { params: Promise<{ year: string }> }) {
  const { year: yp } = use(params);
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner year={Number(yp) || new Date().getFullYear() - 1911} />
      </div>
    </OperatorProvider>
  );
}

function Inner({ year }: { year: number }) {
  const [lampKey, setLampKey] = useState(LAMPS[0].key);
  const [rows, setRows] = useState<Row[]>([]);
  const [orig, setOrig] = useState<Map<string, number | null>>(new Map());
  const [q, setQ] = useState("");
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/print-center/annual-lantern-work-orders/${year}?lampKey=${lampKey}`);
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      const loaded = d.rows as Row[];
      // 載入時自動把「沒有號」的填成接續號碼（不覆蓋既有號）；帶入後視為未儲存變更，按「儲存」才寫回。
      let shown = loaded;
      const active = loaded.filter((r) => r.status !== "CANCELLED");
      const fill = autoAssignWorkOrders(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })));
      if (fill.length > 0) {
        const fm = new Map(fill.map((f) => [f.id, f.workOrder]));
        shown = loaded.map((r) => (fm.has(r.id) ? { ...r, workOrder: fm.get(r.id)! } : r));
      }
      setRows(shown);
      setOrig(new Map(loaded.map((r) => [r.id, r.workOrder])));
    } catch { setErr("讀取失敗"); }
  }, [year, lampKey]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = q.trim();
    return rows.filter((r) => !nq || r.subject.includes(nq) || r.household.includes(nq) || String(r.workOrder ?? "").includes(nq));
  }, [rows, q]);

  const resequence = (arr: Row[]): Row[] => {
    const active = arr.filter((r) => r.status !== "CANCELLED");
    const out = renumberByCurrentSort(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })));
    const m = new Map(out.map((o) => [o.id, o.workOrder]));
    return arr.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r));
  };
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...rows];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRows(resequence(next));
  };
  const moveTo = (id: string, targetStr: string) => {
    const target = Number(targetStr);
    if (!Number.isFinite(target) || target < 1) { setErr("請輸入要移到的號碼（1 起算）"); return; }
    setErr(null);
    const active = rows.filter((r) => r.status !== "CANCELLED");
    const out = moveToPosition(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })), id, target);
    const m = new Map(out.map((o) => [o.id, o.workOrder]));
    const withNums = rows.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r));
    withNums.sort((a, b) => {
      const ca = a.status === "CANCELLED" ? 1 : 0, cb = b.status === "CANCELLED" ? 1 : 0;
      if (ca !== cb) return ca - cb;
      return (a.workOrder ?? 1e9) - (b.workOrder ?? 1e9);
    });
    setRows(withNums);
    setMoveTarget((t) => ({ ...t, [id]: "" }));
    setMsg(`已移到第 ${Math.floor(target)} 號，其餘自動順延（尚未儲存，記得按「儲存」）。`);
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
  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const updates = rows.filter((r) => r.workOrder !== (orig.get(r.id) ?? null)).map((r) => ({ id: r.id, workOrder: r.workOrder }));
      const res = await fetchRegistration(`/api/print-center/annual-lantern-work-orders/${year}`, { method: "POST", body: JSON.stringify({ lampKey, updates }) });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? "儲存失敗"); return; }
      setRows(d.rows);
      setOrig(new Map((d.rows as Row[]).map((r) => [r.id, r.workOrder])));
      setMsg("已儲存並刷新。");
    } catch { setErr("儲存失敗"); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-3 text-lg text-ink">列印管理・年度燈・正式作業編號管理（民國 {year} 年）</h1>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label>燈別
          <select value={lampKey} onChange={(e) => setLampKey(e.target.value)} className="ml-1 rounded border border-cream-300 px-2 py-1">
            {LAMPS.map((l) => <option key={l.key} value={l.key}>{l.label}</option>)}
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 姓名/家戶/號碼" className="rounded border border-cream-300 px-2 py-1" />
        <button onClick={renumber} disabled={busy} className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40">依目前排序重新編號</button>
        <button onClick={() => void load()} disabled={busy} className="rounded-full bg-cream-100 px-3 py-1">恢復原始順序</button>
        <button onClick={() => void save()} disabled={busy} className="rounded-full bg-yolk-200 px-4 py-1 disabled:opacity-40">儲存</button>
      </div>
      <p className="mb-2 text-xs text-ink-faint">號碼已自動帶入（1..N，不用手動編）。要調整順序：在該筆「移到」框輸入目標號碼按「移」；或用 ▲▼ 一格格移。改完按「儲存」。每種燈各自 1..N。</p>
      {msg && <p className="mb-2 text-xs text-sage-700">{msg}</p>}
      {err && <p className="mb-2 text-xs text-rose-600">{err}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white/70 p-3 shadow-card">
        <table className="w-full text-left text-xs">
          <thead><tr className="text-ink-faint">
            <th className="px-2 py-1">移動</th><th className="px-2 py-1">原始序</th><th className="px-2 py-1">正式作業號</th>
            <th className="px-2 py-1">姓名</th><th className="px-2 py-1">家戶</th><th className="px-2 py-1">報名狀態</th><th className="px-2 py-1">列印</th>
          </tr></thead>
          <tbody>
            {filtered.map((r) => {
              const realIdx = rows.findIndex((x) => x.id === r.id);
              return (
                <tr key={r.id} className={`border-t border-cream-200 ${r.status === "CANCELLED" ? "opacity-50" : ""}`}>
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button onClick={() => move(realIdx, -1)} className="px-1">▲</button>
                    <button onClick={() => move(realIdx, 1)} className="px-1">▼</button>
                    {r.status !== "CANCELLED" && (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <span className="text-ink-faint">移到</span>
                        <input
                          value={moveTarget[r.id] ?? ""}
                          onChange={(e) => setMoveTarget((t) => ({ ...t, [r.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") moveTo(r.id, moveTarget[r.id] ?? ""); }}
                          inputMode="numeric"
                          placeholder="第?號"
                          className="w-14 rounded border border-cream-300 px-1 py-0.5"
                        />
                        <button onClick={() => moveTo(r.id, moveTarget[r.id] ?? "")} className="rounded bg-sage-100 px-2 py-0.5">移</button>
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-ink-faint">{r.registrationOrder ?? "—"}</td>
                  <td className="px-2 py-1">
                    <input value={r.workOrder ?? ""} onChange={(e) => setWo(r.id, e.target.value)} disabled={r.status === "CANCELLED"} className="w-16 rounded border border-cream-300 px-1 py-0.5" />
                  </td>
                  <td className="px-2 py-1 text-ink">{r.subject}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.household}</td>
                  <td className="px-2 py-1 text-ink-soft">{r.status === "CANCELLED" ? "已取消(歷史)" : r.status}</td>
                  <td className="px-2 py-1 text-ink-faint">{r.printCount > 0 ? `已印×${r.printCount}` : "未印"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-faint">＊儲存採 transaction；同燈別重號會整批 rollback 並顯示原因。取消資料顯示於此為歷史、不占用新號。</p>
    </main>
  );
}
