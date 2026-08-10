"use client";

import { useRef, useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * 現場快速開感謝狀：填一填 → 直接開立並跳列印。
 * ① 搜信眾(自動用其資料)或當場建新(姓名＋地址)
 * ② 捐獻類快速按鈕(油香/香/犒將/贊助/隨喜)＋其他(自訂)；活動繳款自動帶未收款
 * ③ 現金(可改)→ 開立並列印感謝狀
 */

const DONATION_PRESETS = ["油香", "香", "犒將", "贊助", "隨喜"] as const;

type SearchResult = { memberId: string; name: string; householdId: string; address?: string | null };
type Receivable = { sourceType: string; sourceId: string; itemName: string; activityName?: string | null; unpaidAmount: number; canCollect: boolean; cannotCollectReason?: string | null };
type DonationLine = { key: string; name: string; amount: string; custom: boolean };

let seq = 0;
const nextKey = () => `d${++seq}`;

export default function QuickReceiptScreen({ year }: { year: number }) {
  return (
    <OperatorProvider>
      <Inner year={year} />
    </OperatorProvider>
  );
}

function Inner({ year }: { year: number }) {
  const { operatorUser } = useOperator();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [picked, setPicked] = useState<Record<string, number>>({}); // sourceId -> amount
  const [donations, setDonations] = useState<DonationLine[]>([]);
  const [method, setMethod] = useState("CASH");
  const [recvQuery, setRecvQuery] = useState(""); // 活動繳款清單內搜尋
  const [showRecv, setShowRecv] = useState(false); // 活動繳款清單預設收起（只添油香時不用捲）
  const [allMode, setAllMode] = useState(false); // 幫別人繳：顯示全部未繳（代報名用）
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 防重複送出：同一次「開立」動作固定用一組識別碼（連點／重送只會建一筆收款＋一張收據）。
  const idemRef = useRef<string | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function search(q: string) {
    setQuery(q); setSelected(null); setError(null);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (!term) { setResults([]); return; }
    // 防抖：打字停約 300ms 才查一次，避免連續請求互相蓋掉（打三個字反而沒結果）。
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}${operatorUser?.id ? `&operatorUserId=${encodeURIComponent(operatorUser.id)}` : ""}`);
        const data = await res.json();
        setResults(Array.isArray(data.results) ? data.results : []);
      } catch { /* 搜尋失敗不擋 */ }
    }, 300);
  }
  async function loadReceivables(householdId: string, all: boolean) {
    try {
      // 預設帶「整戶」未繳項目（加戶）；all=true 時不帶家戶條件＝全部未繳（幫別人繳/代報名用，配搜尋）。
      const qs = all ? "" : `?sponsorHouseholdId=${encodeURIComponent(householdId)}`;
      const res = await fetch(`/api/collection-center/pending${qs}`);
      const data = await res.json();
      setReceivables(Array.isArray(data.rows) ? data.rows : []);
    } catch { setReceivables([]); }
  }
  async function pick(m: SearchResult) {
    setSelected(m); setResults([]); setQuery(m.name); setAllMode(false); setRecvQuery("");
    await loadReceivables(m.householdId, false);
  }
  function clearSelected() { setSelected(null); setQuery(""); setReceivables([]); setPicked({}); setAllMode(false); }

  function toggleReceivable(r: Receivable) {
    if (!r.canCollect) return;
    setPicked((prev) => {
      const n = { ...prev };
      if (r.sourceId in n) delete n[r.sourceId];
      else n[r.sourceId] = r.unpaidAmount;
      return n;
    });
  }
  function addDonation(name: string, custom = false) {
    setDonations((prev) => [...prev, { key: nextKey(), name, amount: "", custom }]);
  }
  function updateDonation(key: string, patch: Partial<DonationLine>) {
    setDonations((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  }
  function removeDonation(key: string) { setDonations((prev) => prev.filter((d) => d.key !== key)); }

  const donationTotal = donations.reduce((s, d) => s + (Number(d.amount) > 0 ? Number(d.amount) : 0), 0);
  const activityTotal = Object.values(picked).reduce((s, a) => s + (Number(a) > 0 ? Number(a) : 0), 0);
  const total = donationTotal + activityTotal;

  async function submit() {
    setError(null);
    // 付款人：既有信眾，或當場建新（姓名必填）。
    const payer = selected
      ? { existingMemberId: selected.memberId }
      : { name: newName.trim() || null, address: newAddress.trim() || null, phone: newPhone.trim() || null };
    if (!selected && !newName.trim()) { setError("請先搜尋選一位信眾，或填新付款人姓名"); return; }

    const donLines = donations
      .map((d) => ({ name: d.name.trim(), amount: Number(d.amount) }))
      .filter((d) => d.name && d.amount > 0);
    const actLines = receivables
      .filter((r) => r.sourceId in picked)
      .map((r) => ({ sourceType: r.sourceType, sourceId: r.sourceId, amount: picked[r.sourceId], itemName: r.activityName ? `${r.itemName}（${r.activityName}）` : r.itemName }));
    if (donLines.length === 0 && actLines.length === 0) { setError("請至少加一個項目（捐獻或活動繳款）"); return; }

    setBusy(true);
    if (!idemRef.current) idemRef.current = (globalThis.crypto?.randomUUID?.() ?? `qr-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    try {
      const res = await fetch(`/api/receipt-center/quick-issue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, payer, donations: donLines, activityLines: actLines, methodType: method, year, idempotencyKey: idemRef.current }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "開立失敗，請稍後再試"); return; }
      // 直接跳到收據列印預覽。
      window.location.href = `/receipt-center/receipts/${data.receiptId}/print`;
    } catch {
      setError("網路錯誤，請稍後再試");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ① 付款人 */}
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink-soft">① 付款信眾</h2>
        {selected ? (
          <div className="mt-2 flex flex-wrap items-center gap-3 rounded-xl bg-sage-50 px-4 py-2.5">
            <span className="text-sm text-ink">已選：<b>{selected.name}</b></span>
            <button type="button" onClick={clearSelected} className="text-xs text-ink-faint hover:underline">換一位 / 改填新的</button>
          </div>
        ) : (
          <>
            <input className={`${inputClass} mt-2`} value={query} onChange={(e) => void search(e.target.value)} placeholder="打姓名／電話／地址／家戶編號搜尋既有信眾" />
            {results.length > 0 && (
              <div className="mt-1 max-h-44 overflow-auto rounded-xl border border-cream-200 bg-white">
                {results.map((r) => (
                  <button key={r.memberId} type="button" onClick={() => void pick(r)} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-cream-100">
                    {r.name}　<span className="text-xs text-ink-faint">{r.householdId}{r.address ? `・${r.address}` : ""}</span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs text-ink-faint">查無此人？直接填新付款人（姓名必填，地址選填）：</p>
            <div className="mt-1 grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input className={inputClass} value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="新付款人姓名" />
              <input className={inputClass} value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="電話（選填）" />
              <input className={`${inputClass} sm:col-span-2`} value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="地址（選填）" />
            </div>
          </>
        )}
      </section>

      {/* ② 項目 */}
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h2 className="text-sm text-ink-soft">② 加項目</h2>

        <p className="mt-3 text-xs text-ink-faint">捐獻（金額自由填）</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {DONATION_PRESETS.map((name) => (
            <button key={name} type="button" onClick={() => addDonation(name)} className="rounded-full bg-yolk-50 px-3 py-1.5 text-sm text-ink hover:bg-yolk-100">＋ {name}</button>
          ))}
          <button type="button" onClick={() => addDonation("", true)} className="rounded-full bg-cream-200 px-3 py-1.5 text-sm text-ink-soft hover:bg-cream-300">＋ 其他</button>
        </div>
        {donations.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            {donations.map((d) => (
              <div key={d.key} className="flex flex-wrap items-center gap-2 rounded-xl bg-cream-50 px-3 py-2">
                {d.custom ? (
                  <input className={`${inputClass} flex-1`} value={d.name} onChange={(e) => updateDonation(d.key, { name: e.target.value })} placeholder="項目名稱（例：神明聖壽、壽桃麵塔）" />
                ) : (
                  <span className="flex-1 text-sm text-ink">{d.name}</span>
                )}
                <input type="number" min={1} className={`${inputClass} w-28 text-right`} value={d.amount} onChange={(e) => updateDonation(d.key, { amount: e.target.value })} placeholder="金額" />
                <button type="button" onClick={() => removeDonation(d.key)} className="text-xs text-ink-faint hover:underline">移除</button>
              </div>
            ))}
          </div>
        )}

        {selected && (
          <div className="mt-4 rounded-2xl border border-cream-200 bg-cream-50/60 p-3">
            {/* 預設收起：只添油香等捐獻時不用捲過一長串活動清單。要繳活動費才展開。 */}
            <button
              type="button"
              onClick={() => setShowRecv((v) => !v)}
              className="flex w-full items-center justify-between text-sm text-ink"
            >
              <span>
                🎫 活動繳款
                {Object.keys(picked).length > 0
                  ? <span className="ml-1 text-sage-600">（已選 {Object.keys(picked).length} 筆）</span>
                  : <span className="ml-1 text-ink-faint">（未繳 {receivables.length} 筆，只添油香可略過）</span>}
              </span>
              <span className="text-ink-faint">{showRecv ? "收起 ▲" : "展開 ▼"}</span>
            </button>

            {showRecv && (
              <>
                <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
                  <input
                    type="checkbox"
                    checked={allMode}
                    onChange={(e) => { const on = e.target.checked; setAllMode(on); setRecvQuery(""); if (selected) void loadReceivables(selected.householdId, on); }}
                  />
                  幫別人繳（顯示全部未繳，用搜尋找）
                </label>
                <p className="mt-1 text-xs text-ink-faint">
                  {allMode ? "目前顯示全部信眾的未繳項目，請用下方搜尋找到要繳的那筆。" : `目前只顯示「${selected?.name ?? ""}」整戶的未繳項目。`}
                </p>
                {receivables.length > 3 && (
                  <input
                    value={recvQuery}
                    onChange={(e) => setRecvQuery(e.target.value)}
                    placeholder="🔍 搜尋牌位名／陽上／認購人／活動"
                    className="mt-2 w-full rounded-lg border border-cream-200 px-3 py-2 text-base text-ink"
                  />
                )}
                <div className="mt-2 flex max-h-72 flex-col gap-2 overflow-auto">
                  {receivables.length === 0 && <p className="text-sm text-ink-faint">這位信眾目前沒有未收款項。</p>}
                  {receivables
                    .filter((r) => {
                      const q = recvQuery.trim();
                      if (!q) return true;
                      return `${r.itemName}${r.activityName ?? ""}`.includes(q);
                    })
                    .map((r) => (
                    <label key={`${r.sourceType}-${r.sourceId}`} className="flex items-center justify-between gap-3 rounded-xl bg-white px-4 py-2.5">
                      <span className="flex items-center gap-2 text-sm text-ink">
                        <input type="checkbox" disabled={!r.canCollect} checked={r.sourceId in picked} onChange={() => toggleReceivable(r)} />
                        {r.itemName}{r.activityName ? `・${r.activityName}` : ""}
                        {!r.canCollect && <span className="text-xs text-blossom-500">（{r.cannotCollectReason ?? "無法收款"}）</span>}
                      </span>
                      <span className="text-sm text-ink-soft">{r.unpaidAmount.toLocaleString("zh-Hant")} 元</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </section>

      {/* ③ 付款方式＋開立 */}
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <label className="flex flex-col gap-1">
            <span className={labelClass}>付款方式</span>
            <select className={`${inputClass} w-40`} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="CASH">現金</option>
              <option value="BANK_TRANSFER">轉帳</option>
              <option value="CHECK">支票</option>
              <option value="OTHER">其他</option>
            </select>
          </label>
          <p className="text-lg text-ink">合計：<b>{total.toLocaleString("zh-Hant")}</b> 元</p>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void submit()} disabled={busy || total <= 0} className={primaryButtonClass}>
            {busy ? "開立中…" : "開立並列印感謝狀"}
          </button>
          <a href="/" className={secondaryButtonClass}>取消</a>
        </div>
        {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
        <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          按下即建立收款並開立一張感謝狀，自動跳到列印預覽（可下載 PDF）。一張感謝狀可含多個項目，財務仍各自分開計。
        </p>
      </section>
    </div>
  );
}
