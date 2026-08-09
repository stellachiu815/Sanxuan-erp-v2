"use client";

import { useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * 名單型（贊普型）現場快速報名表單——補庫／宮燈／年度燈共用。
 * 一位報名者可幫多人報(多列);每列可「搜既有信眾帶入」或「填新信眾」。
 * 送出走 /api/roster-registration(共用引擎 rosterRegister),預設立即確認為正式。
 */

type Row = {
  existingMemberId: string;
  existingLabel: string;
  name: string;
  phone: string;
  address: string;
  solarBirthDate: string;
  quantity: string;
};
type SearchResult = { memberId: string; name: string; householdName: string; address: string | null };

const emptyRow = (): Row => ({ existingMemberId: "", existingLabel: "", name: "", phone: "", address: "", solarBirthDate: "", quantity: "1" });

export default function RosterRegisterForm(props: { templeEventId: string; activityName: string }) {
  return (
    <OperatorProvider>
      <Inner {...props} />
    </OperatorProvider>
  );
}

function Inner({ templeEventId, activityName }: { templeEventId: string; activityName: string }) {
  const { operatorUser } = useOperator();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [results, setResults] = useState<Record<number, SearchResult[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  function update(i: number, patch: Partial<Row>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setOkMsg(null);
  }
  function addRow() { setRows((prev) => [...prev, emptyRow()]); }
  function removeRow(i: number) {
    setRows((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
    setResults((prev) => { const n = { ...prev }; delete n[i]; return n; });
  }

  async function search(i: number, q: string) {
    update(i, { name: q, existingMemberId: "", existingLabel: "" });
    if (q.trim().length < 1) { setResults((p) => ({ ...p, [i]: [] })); return; }
    try {
      const res = await fetch(`/api/roster-registration/devotees?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json();
      setResults((p) => ({ ...p, [i]: Array.isArray(data.results) ? data.results : [] }));
    } catch { /* 搜尋失敗不擋填寫 */ }
  }
  function pickExisting(i: number, r: SearchResult) {
    update(i, { existingMemberId: r.memberId, existingLabel: `${r.name}（${r.householdName}）`, name: r.name, address: r.address ?? "" });
    setResults((p) => ({ ...p, [i]: [] }));
  }
  function clearExisting(i: number) {
    update(i, { existingMemberId: "", existingLabel: "", name: "", address: "" });
  }

  async function submit() {
    setError(null);
    setOkMsg(null);
    const people = rows
      .map((r) => ({
        existingMemberId: r.existingMemberId.trim() || null,
        name: r.name.trim() || null,
        phone: r.phone.trim() || null,
        address: r.address.trim() || null,
        birthdayType: r.solarBirthDate.trim() ? ("SOLAR" as const) : null,
        solarBirthDate: r.solarBirthDate.trim() || null,
        quantity: Number(r.quantity) > 0 ? Number(r.quantity) : 1,
      }))
      .filter((p) => p.existingMemberId || p.name);
    if (people.length === 0) { setError("請至少填一位報名者的姓名"); return; }

    setBusy(true);
    try {
      const res = await fetch(`/api/roster-registration`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, templeEventId, people, confirm: true }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "報名失敗，請稍後再試一次。"); return; }
      setOkMsg(data.message ?? "已完成報名。");
      setRows([emptyRow()]);
      setResults({});
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h1 className="text-lg text-ink">{activityName}・現場快速報名</h1>
        <p className="mt-1 text-sm text-ink-soft">一人一份、固定單價。可幫家人朋友一起報（多列）；每位可「搜既有信眾帶入」或直接填新信眾（系統自動建檔）。</p>

        <div className="mt-4 flex flex-col gap-3">
          {rows.map((r, i) => (
            <div key={i} className="rounded-2xl bg-cream-50 p-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-ink-soft">第 {i + 1} 位</span>
                {rows.length > 1 && (
                  <button type="button" onClick={() => removeRow(i)} className="text-xs text-blossom-500 hover:underline">移除</button>
                )}
              </div>

              {r.existingMemberId ? (
                <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-sage-50 px-4 py-2.5">
                  <span className="text-sm text-ink">已選既有信眾：<b>{r.existingLabel}</b></span>
                  <button type="button" onClick={() => clearExisting(i)} className="text-xs text-ink-faint hover:underline">改填新的 / 換一位</button>
                </div>
              ) : (
                <>
                  <label className="mt-2 flex flex-col gap-1">
                    <span className={labelClass}>姓名（打字可搜既有信眾，或直接當新信眾）</span>
                    <input className={inputClass} value={r.name} onChange={(e) => void search(i, e.target.value)} placeholder="信眾姓名" />
                  </label>
                  {(results[i]?.length ?? 0) > 0 && (
                    <div className="mt-1 max-h-40 overflow-auto rounded-xl border border-cream-200 bg-white">
                      {results[i].map((res) => (
                        <button key={res.memberId} type="button" onClick={() => pickExisting(i, res)} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-cream-100">
                          {res.name}　<span className="text-xs text-ink-faint">{res.householdName}{res.address ? `・${res.address}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>電話</span>
                      <input className={inputClass} value={r.phone} onChange={(e) => update(i, { phone: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>國曆生日（選填）</span>
                      <input type="date" className={inputClass} value={r.solarBirthDate} onChange={(e) => update(i, { solarBirthDate: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className={labelClass}>地址</span>
                      <input className={inputClass} value={r.address} onChange={(e) => update(i, { address: e.target.value })} />
                    </label>
                  </div>
                </>
              )}

              <label className="mt-2 flex flex-col gap-1">
                <span className={labelClass}>份數</span>
                <input type="number" min={1} className={`${inputClass} w-28`} value={r.quantity} onChange={(e) => update(i, { quantity: e.target.value })} />
              </label>
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addRow} className={secondaryButtonClass}>＋ 再加一位</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={primaryButtonClass}>
            {busy ? "報名中…" : "完成報名"}
          </button>
          {okMsg && <span className="text-sm text-sage-500">{okMsg}</span>}
        </div>
        {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
        <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          送出即建立正式報名（金額＝固定單價 × 份數）。新信眾會自動建成信眾資料;之後可到信眾頁補齊其他欄位。
        </p>
      </section>
    </div>
  );
}
