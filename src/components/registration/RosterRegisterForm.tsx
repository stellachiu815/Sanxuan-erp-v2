"use client";

import { useRef, useState } from "react";
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
  householdId: string;
  name: string;
  phone: string;
  address: string;
  solarBirthDate: string;
  // V41 現場核對用（唯讀顯示）：選既有信眾時帶入農曆生日／虛歲／生肖。
  existingLunar: string;
  existingAge: string;
  existingZodiac: string;
  quantity: string;
};
type SearchResult = { memberId: string; householdId: string; name: string; householdName: string; address: string | null; lunarBirthDisplay: string | null; nominalAge: number | null; zodiac: string | null; solarBirthDate: string | null };

const emptyRow = (): Row => ({ existingMemberId: "", existingLabel: "", householdId: "", name: "", phone: "", address: "", solarBirthDate: "", existingLunar: "", existingAge: "", existingZodiac: "", quantity: "1" });

export default function RosterRegisterForm(props: { templeEventId: string; activityName: string; publicSlug?: string }) {
  return (
    <OperatorProvider>
      <Inner {...props} />
    </OperatorProvider>
  );
}

function Inner({ templeEventId, activityName, publicSlug }: { templeEventId: string; activityName: string; publicSlug?: string }) {
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

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function search(i: number, q: string) {
    update(i, { name: q, existingMemberId: "", existingLabel: "" });
    // 公開報名(信眾自己填)不查既有信眾資料庫——一律當新資料填,廟方確認時再比對/建檔。
    if (publicSlug) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 1) { setResults((p) => ({ ...p, [i]: [] })); return; }
    // 防抖：打字停下約 300ms 才查一次（不再每個字都打一次 API，避免卡頓）。
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/roster-registration/devotees?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setResults((p) => ({ ...p, [i]: Array.isArray(data.results) ? data.results : [] }));
      } catch { /* 搜尋失敗不擋填寫 */ }
    }, 300);
  }
  function pickExisting(i: number, r: SearchResult) {
    update(i, {
      existingMemberId: r.memberId, existingLabel: `${r.name}（${r.householdName}）`, householdId: r.householdId, name: r.name, address: r.address ?? "",
      existingLunar: r.lunarBirthDisplay ?? "", existingAge: r.nominalAge != null ? String(r.nominalAge) : "", existingZodiac: r.zodiac ?? "",
    });
    setResults((p) => ({ ...p, [i]: [] }));
  }
  function clearExisting(i: number) {
    update(i, { existingMemberId: "", existingLabel: "", householdId: "", name: "", address: "", existingLunar: "", existingAge: "", existingZodiac: "" });
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
    // 報名必填：姓名、生日、地址（電話選填）。新填的信眾（沒選既有）必須三項都齊，
    // 缺任一不給送出——與「缺必備資料不能確認報名」一致。既有信眾由後端檢查其資料是否齊全。
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      if (p.existingMemberId) continue;
      const miss: string[] = [];
      if (!p.name) miss.push("姓名");
      if (!p.solarBirthDate) miss.push("生日");
      if (!p.address) miss.push("地址");
      if (miss.length > 0) { setError(`第 ${i + 1} 位還缺：${miss.join("、")}（點燈／報名都需要姓名、生日、地址）`); return; }
    }

    setBusy(true);
    try {
      const res = publicSlug
        ? await fetch(`/api/public-reg/${encodeURIComponent(publicSlug)}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "ROSTER", people: people.map((p) => ({ name: p.name, phone: p.phone, address: p.address, solarBirthDate: p.solarBirthDate, quantity: p.quantity })) }),
          })
        : await fetch(`/api/roster-registration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, templeEventId, people, confirm: true }),
          });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "報名失敗，請稍後再試一次。"); return; }
      setOkMsg(publicSlug ? "已送出報名！廟方核對後就會正式成立，感謝您。" : (data.message ?? "已完成報名。"));
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
        <h1 className="text-lg text-ink">{activityName}・{publicSlug ? "線上報名" : "現場快速報名"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          {publicSlug
            ? "一人一份。可幫家人朋友一起報（多列），每位填一組資料。送出後由廟方核對成立。"
            : "一人一份、固定單價。可幫家人朋友一起報（多列）；每位可「搜既有信眾帶入」或直接填新信眾（系統自動建檔）。"}
        </p>

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
                <div className="mt-2 flex flex-col gap-1 rounded-xl bg-sage-50 px-4 py-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-ink">已選既有信眾：<b>{r.existingLabel}</b></span>
                    {!publicSlug && r.householdId && (
                      <a href={`/household/${r.householdId}`} className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft hover:bg-mist-200">🏠 進這一戶完整報名（選家人／既有牌位）</a>
                    )}
                    <button type="button" onClick={() => clearExisting(i)} className="text-xs text-ink-faint hover:underline">改填新的 / 換一位</button>
                  </div>
                  {/* V41 現場核對（唯讀）：農曆生日／歲數（生肖）／地址，資料有誤進家戶頁改。 */}
                  <p className="text-xs text-ink-soft">
                    核對資料　農曆生日：<b className="text-ink">{r.existingLunar || "未登記"}</b>
                    　｜　歲數：<b className="text-ink">{r.existingAge ? `虛歲 ${r.existingAge}` : "未登記"}</b>
                    {r.existingZodiac ? `（生肖 ${r.existingZodiac}）` : ""}
                    　｜　地址：<b className="text-ink">{r.address || "未登記"}</b>
                  </p>
                  <p className="text-[11px] text-ink-faint">資料有誤請按「🏠 進這一戶完整報名」到家戶頁修改（此處唯讀）。</p>
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
                      <span className={labelClass}>電話（選填）</span>
                      <input className={inputClass} value={r.phone} onChange={(e) => update(i, { phone: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>國曆生日 <span className="text-blossom-500">＊必填</span></span>
                      <input type="date" className={inputClass} value={r.solarBirthDate} onChange={(e) => update(i, { solarBirthDate: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className={labelClass}>地址 <span className="text-blossom-500">＊必填</span></span>
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
            {busy ? (publicSlug ? "送出中…" : "報名中…") : (publicSlug ? "送出報名" : "完成報名")}
          </button>
          {okMsg && <span className="text-sm text-sage-500">{okMsg}</span>}
        </div>
        {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
        <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          {publicSlug
            ? "送出後會進入廟方的「待確認清單」，由廟方核對後才正式成立、不會馬上收款。感謝您的報名。"
            : "送出即建立正式報名（金額＝固定單價 × 份數）。新信眾會自動建成信眾資料;之後可到信眾頁補齊其他欄位。"}
        </p>
      </section>
    </div>
  );
}
