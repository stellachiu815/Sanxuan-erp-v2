"use client";

import { useMemo, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import BackButton from "@/components/navigation/BackButton";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V38 批次記帳（貼上）＋ 清空並重設期初。
 *  貼上格式（從 Excel/試算表整段複製，Tab 分隔）：日期 類別 品項 收入 支出
 *  日期留空＝沿用上一筆；收入或支出擇一填；帳戶預設現金。
 */

const EXPENSE_CATEGORIES = ["雜支", "犒將", "水電瓦斯", "友宮回禮", "金紙", "清潔費", "花果", "其他"];
type ParsedRow = { occurredOn: string; kind: "INCOME" | "EXPENSE"; category: string; description: string; amount: number; raw: string; error?: string };

const money = (n: number) => n.toLocaleString("zh-Hant");
const num = (s: string) => Number((s ?? "").replace(/[,，$\s]/g, "")) || 0;

function normDate(s: string, prev: string, defYear: number): string {
  const t = (s ?? "").trim();
  if (!t) return prev;
  const parts = t.replace(/[./年月]/g, "-").replace(/日/g, "").split("-").map((x) => x.trim()).filter(Boolean);
  let y: number, m: number, d: number;
  if (parts.length >= 3) { y = Number(parts[0]); m = Number(parts[1]); d = Number(parts[2]); }
  else if (parts.length === 2) { y = defYear; m = Number(parts[0]); d = Number(parts[1]); }
  else return prev;
  if (y < 1911) y += 1911; // 若填民國年自動轉西元
  if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 2000)) return "";
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function parse(text: string): ParsedRow[] {
  const defYear = new Date().getFullYear();
  let prevDate = "";
  const out: ParsedRow[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const cols = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|,|，/);
    const [c0 = "", c1 = "", c2 = "", c3 = "", c4 = ""] = cols.map((c) => c.trim());
    const date = normDate(c0, prevDate, defYear);
    if (date) prevDate = date;
    const income = num(c3);
    const expense = num(c4);
    const kind: "INCOME" | "EXPENSE" = income > 0 && expense <= 0 ? "INCOME" : "EXPENSE";
    const amount = kind === "INCOME" ? income : expense;
    const row: ParsedRow = { occurredOn: date, kind, category: c1 || "其他", description: c2, amount, raw: line };
    if (!date) row.error = "日期無法辨識";
    else if (!(amount > 0)) row.error = "沒有金額";
    out.push(row);
  }
  return out;
}

export default function FinanceBatchPage() {
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
  const [text, setText] = useState("");
  const [account, setAccount] = useState<"CASH" | "BANK">("CASH");
  const rows = useMemo(() => parse(text), [text]);
  const good = rows.filter((r) => !r.error);
  const bad = rows.filter((r) => r.error);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 清空重設
  const [bankOpen, setBankOpen] = useState("1742325");
  const [cashOpen, setCashOpen] = useState("34000");
  const [resetBusy, setResetBusy] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);

  async function submitBatch() {
    if (good.length === 0) { setErr("沒有可匯入的有效資料"); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration("/api/finance-center/batch", {
        method: "POST",
        body: JSON.stringify({ rows: good.map((r) => ({ occurredOn: r.occurredOn, kind: r.kind, account, category: r.category, amount: r.amount, description: r.description || null })) }),
      });
      const data = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, data?.error)); return; }
      setMsg(`已匯入 ${data.created} 筆。可回財務中心看流水帳。`);
      setText("");
    } catch { setErr("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  async function doReset() {
    if (!window.confirm(`確定要「清空整個財務中心」並重設期初？\n銀行期初：${money(num(bankOpen))}／現金期初：${money(num(cashOpen))}\n⚠️ 現有所有財務紀錄會被永久刪除、不可還原（活動收款不受影響）。`)) return;
    setResetBusy(true); setResetMsg(null); setErr(null);
    try {
      const res = await fetchRegistration("/api/finance-center/reset", {
        method: "POST", body: JSON.stringify({ bankOpening: num(bankOpen), cashOpening: num(cashOpen), confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) { setResetMsg("⚠️ " + toFriendlyError(res.status, data?.error)); return; }
      setResetMsg(`✅ 已清空並重設：刪除 ${data.deleted} 筆、期初 銀行 ${money(num(bankOpen))}／現金 ${money(num(cashOpen))}。`);
    } catch { setResetMsg("⚠️ 連線問題，請稍後再試。"); } finally { setResetBusy(false); }
  }

  const inputCls = "min-h-10 rounded-xl border border-cream-300 px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <BackButton fallbackHref="/finance-center" />
        <h1 className="text-lg text-ink">批次記帳／清空重設</h1>
      </div>

      {/* 清空並重設期初（最高管理員） */}
      <section className="rounded-2xl bg-white/70 p-5 shadow-card">
        <h2 className="text-base font-medium text-ink">① 清空財務中心並重設期初（只在初次設定用）</h2>
        <p className="mt-1 text-sm text-ink-soft">把現在流水帳裡的<b>測試／範例資料全部清掉</b>，重新設乾淨的期初。<b className="text-blossom-500">會永久刪除、不可還原</b>（活動收款不受影響）。做過一次就不用再做。</p>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-ink-soft">銀行期初<input value={bankOpen} onChange={(e) => setBankOpen(e.target.value)} inputMode="numeric" className={`${inputCls} w-36`} /></label>
          <label className="flex flex-col gap-1 text-xs text-ink-soft">現金期初<input value={cashOpen} onChange={(e) => setCashOpen(e.target.value)} inputMode="numeric" className={`${inputCls} w-32`} /></label>
          <button type="button" disabled={resetBusy} onClick={doReset} style={{ backgroundColor: "#c0392b", color: "#fff", opacity: resetBusy ? 0.5 : 1 }} className="rounded-full px-5 py-2 text-sm font-semibold">
            {resetBusy ? "清空中…" : "清空並重設期初"}
          </button>
        </div>
        {resetMsg && <p className="mt-2 text-sm text-ink">{resetMsg}</p>}
      </section>

      {/* 批次記帳 */}
      <section className="rounded-2xl bg-white/70 p-5 shadow-card">
        <h2 className="text-base font-medium text-ink">② 批次記帳（從試算表整段貼上）</h2>
        <p className="mt-1 text-sm text-ink-soft">
          每行一筆，欄位順序＝<b>日期　類別　品項　收入　支出</b>（用 Tab 分隔，直接從 Google 試算表整段複製貼上即可）。
          日期留空＝沿用上一筆；收入、支出擇一填；類別留空＝其他。
        </p>
        <div className="mt-2 text-xs text-ink-faint">
          範例：<br />
          <code>2026/07/04　雜支　許澤承南巡　　6800</code><br />
          <code>　　花果　水果　　1020</code>（日期沿用上一筆、支出 1020）
        </div>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-ink-soft">帳戶</span>
          {(["CASH", "BANK"] as const).map((a) => (
            <button key={a} type="button" onClick={() => setAccount(a)} className={`rounded-full px-4 py-1.5 text-sm ${account === a ? "bg-sage-200 text-ink" : "bg-cream-100 text-ink-soft"}`}>{a === "CASH" ? "現金" : "銀行"}</button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} placeholder="從試算表整段複製貼上…" className="mt-3 w-full rounded-xl border border-cream-300 p-3 text-sm font-mono" />

        {rows.length > 0 && (
          <div className="mt-3 text-sm">
            <p className="text-ink">解析到 {rows.length} 行｜可匯入 <b className="text-sage-600">{good.length}</b> 筆{bad.length > 0 && <span className="text-blossom-500">｜有問題 {bad.length} 行（下方紅字，修正後再貼）</span>}</p>
            <div className="mt-2 max-h-72 overflow-auto rounded-xl border border-cream-200">
              <table className="w-full text-xs">
                <thead className="bg-cream-100 text-ink-soft"><tr><th className="p-1.5 text-left">日期</th><th className="p-1.5 text-left">收/支</th><th className="p-1.5 text-left">類別</th><th className="p-1.5 text-left">品項</th><th className="p-1.5 text-right">金額</th></tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className={r.error ? "bg-blossom-50" : ""}>
                      <td className="p-1.5">{r.occurredOn || "—"}</td>
                      <td className="p-1.5">{r.kind === "INCOME" ? "收入" : "支出"}</td>
                      <td className="p-1.5">{r.category}</td>
                      <td className="p-1.5">{r.description}</td>
                      <td className="p-1.5 text-right">{r.error ? <span className="text-blossom-500">{r.error}</span> : money(r.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {err && <p className="mt-2 text-sm text-blossom-500">⚠️ {err}</p>}
        {msg && <p className="mt-2 text-sm text-sage-600">✓ {msg}</p>}

        <button type="button" disabled={busy || good.length === 0} onClick={submitBatch} className="mt-3 rounded-full bg-yolk-200 px-6 py-2.5 text-sm font-semibold text-ink hover:bg-yolk-300 disabled:opacity-40">
          {busy ? "匯入中…" : `確認匯入 ${good.length} 筆`}
        </button>
        <p className="mt-1 text-xs text-ink-faint">支出常用類別：{EXPENSE_CATEGORIES.join("、")}</p>
      </section>
    </main>
  );
}
