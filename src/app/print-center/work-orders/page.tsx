"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import { renumberByCurrentSort, autoAssignWorkOrders, moveToPosition, type WorkOrderRow as WORow } from "@/lib/workOrder";

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
  // V38：改「照列印批次」——祖先組（黃紙）／冤親組（粉紅），整批一起編號。
  const [batch, setBatch] = useState<"ancestor-soul" | "creditor">("ancestor-soul");
  const [rows, setRows] = useState<Row[]>([]);
  const [orig, setOrig] = useState<Map<string, number | null>>(new Map());
  const [locked, setLocked] = useState(false);
  const [q, setQ] = useState("");
  const [moveTarget, setMoveTarget] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders?batch=${batch}`);
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      const loaded = d.rows as Row[];
      // V38：號碼不再一片空白——載入時自動把「沒有號」的填成接續的號碼（不覆蓋既有號）。
      //   未鎖定才自動帶入；帶入後視為未儲存變更，按「儲存」才寫回。
      let shown = loaded;
      if (!d.locked) {
        const active = loaded.filter((r) => r.status !== "CANCELLED");
        const fill = autoAssignWorkOrders(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })));
        if (fill.length > 0) {
          const fm = new Map(fill.map((f) => [f.id, f.workOrder]));
          shown = loaded.map((r) => (fm.has(r.id) ? { ...r, workOrder: fm.get(r.id)! } : r));
        }
      }
      setRows(shown); setLocked(d.locked);
      // orig＝資料庫實際值（含 null），這樣自動帶入的號會被視為「需儲存」。
      setOrig(new Map(loaded.map((r) => [r.id, r.workOrder])));
    } catch { setErr("讀取失敗"); }
  }, [year, batch]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const nq = q.trim();
    return rows.filter((r) => !nq || r.subject.includes(nq) || r.household.includes(nq) || r.yangshang.includes(nq) || String(r.workOrder ?? "").includes(nq));
  }, [rows, q]);

  // 依目前 rows 陣列順序，把 active（未取消）重編 1..N；順序不變、只更新號碼。
  const resequence = (arr: Row[]): Row[] => {
    const active = arr.filter((r) => r.status !== "CANCELLED");
    const out = renumberByCurrentSort(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })));
    const m = new Map(out.map((o) => [o.id, o.workOrder]));
    return arr.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r));
  };

  // ▲▼：上下移一格，並**即時重編號碼**（可連續移動，不再只動一次）。
  const move = (idx: number, dir: -1 | 1) => {
    if (locked) return;
    const next = [...rows];
    const j = idx + dir;
    if (j < 0 || j >= next.length) return;
    [next[idx], next[j]] = [next[j], next[idx]];
    setRows(resequence(next));
  };

  // 「移到第 N 號」：插入語意——本筆跳到第 N 號，原本第 N..尾各自順延 +1，全類別重編 1..N。
  const moveTo = (id: string, targetStr: string) => {
    if (locked) return;
    const target = Number(targetStr);
    if (!Number.isFinite(target) || target < 1) { setErr("請輸入要移到的號碼（1 起算）"); return; }
    setErr(null);
    const active = rows.filter((r) => r.status !== "CANCELLED");
    const out = moveToPosition(active.map<WORow>((r) => ({ id: r.id, categoryKey: r.itemKey, workOrder: r.workOrder })), id, target);
    const m = new Map(out.map((o) => [o.id, o.workOrder]));
    const withNums = rows.map((r) => (m.has(r.id) ? { ...r, workOrder: m.get(r.id)! } : r));
    // 依新號碼重新排序，讓畫面立刻反映移動結果（取消者排最後）。
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
  // V38 批次模式：「依原始順序」＝重新載入（後端已照建立先後＝匯入順序，載入時自動帶 1..N）。
  const proposeInitial = async () => {
    await load();
    setMsg("已依原始報名順序（Excel 匯入在前、之後新增往後）重新帶入號碼。");
  };


  const save = async () => {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const updates = rows.filter((r) => r.workOrder !== (orig.get(r.id) ?? null)).map((r) => ({ id: r.id, workOrder: r.workOrder }));
      const res = await fetchRegistration(`/api/universal-salvation/${year}/work-orders`, { method: "POST", body: JSON.stringify({ batch, updates }) });
      const d = await res.json();
      if (!res.ok) { setErr(d?.error ?? "儲存失敗"); return; }
      setRows(d.rows); setLocked(d.locked);
      setOrig(new Map((d.rows as Row[]).map((r) => [r.id, r.workOrder])));
      setMsg("已儲存並刷新。");
    } catch { setErr("儲存失敗"); } finally { setBusy(false); }
  };

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="mb-3 text-lg text-ink">列印管理・中元普渡・正式作業編號管理</h1>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <label>年度 <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} className="w-20 rounded border border-cream-300 px-2 py-1" /></label>
        <label>列印批次
          <select value={batch} onChange={(e) => setBatch(e.target.value as "ancestor-soul" | "creditor")} className="ml-1 rounded border border-cream-300 px-2 py-1">
            <option value="ancestor-soul">祖先／乙位正魂／地基主（黃紙）</option>
            <option value="creditor">冤親／無緣（粉紅紙）</option>
          </select>
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜尋 姓名/家戶/陽上/號碼" className="rounded border border-cream-300 px-2 py-1" />
        <button onClick={proposeInitial} disabled={busy || locked} className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40">依原始順序產生初始號碼</button>
        <button onClick={renumber} disabled={busy || locked} className="rounded-full bg-cream-100 px-3 py-1 disabled:opacity-40">依目前排序重新編號</button>
        <button onClick={() => void load()} disabled={busy} className="rounded-full bg-cream-100 px-3 py-1">恢復原始順序</button>
        <button onClick={() => void save()} disabled={busy || locked} className="rounded-full bg-yolk-200 px-4 py-1 disabled:opacity-40">儲存</button>
      </div>
      <p className="mb-2 text-xs text-ink-faint">號碼已自動帶入（1..N，不用手動編）。要調整順序：在該筆「移到」框輸入目標號碼按「移」——例如把 76 移到 5，原本 5 之後全部自動順延；或用 ▲▼ 一格格移。改完按「儲存」。</p>
      {locked && <p className="mb-2 text-xs text-rose-600">已鎖定：Excel／牌位／寶袋使用已鎖定號碼；需先解除才能修改，新增資料排最後不重排既有號。</p>}
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
                  <td className="px-2 py-1 whitespace-nowrap">
                    <button onClick={() => move(realIdx, -1)} disabled={locked} className="px-1">▲</button>
                    <button onClick={() => move(realIdx, 1)} disabled={locked} className="px-1">▼</button>
                    {r.status !== "CANCELLED" && (
                      <span className="ml-1 inline-flex items-center gap-1">
                        <span className="text-ink-faint">移到</span>
                        <input
                          value={moveTarget[r.id] ?? ""}
                          onChange={(e) => setMoveTarget((t) => ({ ...t, [r.id]: e.target.value }))}
                          onKeyDown={(e) => { if (e.key === "Enter") moveTo(r.id, moveTarget[r.id] ?? ""); }}
                          disabled={locked}
                          inputMode="numeric"
                          placeholder="第?號"
                          className="w-14 rounded border border-cream-300 px-1 py-0.5"
                        />
                        <button onClick={() => moveTo(r.id, moveTarget[r.id] ?? "")} disabled={locked} className="rounded bg-sage-100 px-2 py-0.5 disabled:opacity-40">移</button>
                      </span>
                    )}
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
