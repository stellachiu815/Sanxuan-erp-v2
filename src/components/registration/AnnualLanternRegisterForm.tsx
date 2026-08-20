"use client";

import { useRef, useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, secondaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * 年度燈（光明燈／太歲燈）現場快速報名＋公開報名表單。
 * 一位報名者可幫多人報（多列）；每位可勾「光明燈／太歲燈」（可複選）並各填份數。
 * 報名必填：姓名、生日、地址（點燈要算歲數／生肖）。電話選填。
 * 走 /api/annual-lantern-registration（共用引擎，立即確認）；公開模式改送 /api/public-reg/[slug]/submit（建草稿）。
 */

type Row = {
  existingMemberId: string;
  existingLabel: string;
  householdId: string;
  name: string;
  phone: string;
  address: string;
  gender: string;
  solarBirthDate: string;
  // V41 現場核對用（唯讀顯示）：選既有信眾時帶入農曆生日／虛歲／生肖。
  existingLunar: string;
  existingAge: string;
  existingZodiac: string;
  // V41 重複報名提示：這個人今年已報名的項目。
  existingYearReg: string;
  guangming: boolean;
  guangmingQty: string;
  taisui: boolean;
  taisuiQty: string;
  purification: boolean;
};
type SearchResult = { memberId: string; householdId: string; name: string; householdName: string; address: string | null; lunarBirthDisplay: string | null; nominalAge: number | null; zodiac: string | null; solarBirthDate: string | null; yearRegistrations: string };

const emptyRow = (): Row => ({ existingMemberId: "", existingLabel: "", householdId: "", name: "", phone: "", address: "", gender: "", solarBirthDate: "", existingLunar: "", existingAge: "", existingZodiac: "", existingYearReg: "", guangming: true, guangmingQty: "1", taisui: false, taisuiQty: "1", purification: false });

export default function AnnualLanternRegisterForm(props: { templeEventId: string; activityName: string; publicSlug?: string }) {
  return (
    <OperatorProvider>
      <Inner {...props} />
    </OperatorProvider>
  );
}

type FamilyMemberRow = { name: string; solarBirthDate: string; gender: string };

function Inner({ templeEventId, activityName, publicSlug }: { templeEventId: string; activityName: string; publicSlug?: string }) {
  const { operatorUser } = useOperator();
  const [rows, setRows] = useState<Row[]>([emptyRow()]);
  const [results, setResults] = useState<Record<number, SearchResult[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  // 全家燈（整戶一份）。staff：挑既有信眾→全戶納入；public：戶長＋地址＋家人名單。
  const [familyOn, setFamilyOn] = useState(false);
  const [familyMemberId, setFamilyMemberId] = useState("");
  const [familyMemberLabel, setFamilyMemberLabel] = useState("");
  const [familySearch, setFamilySearch] = useState("");
  const [familyResults, setFamilyResults] = useState<SearchResult[]>([]);
  const [famContact, setFamContact] = useState({ name: "", phone: "", address: "" });
  const [famMembers, setFamMembers] = useState<FamilyMemberRow[]>([{ name: "", solarBirthDate: "", gender: "" }]);

  const familyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function familyDoSearch(q: string) {
    setFamilySearch(q); setFamilyMemberId(""); setFamilyMemberLabel(""); setOkMsg(null);
    if (familyTimer.current) clearTimeout(familyTimer.current);
    const term = q.trim();
    if (term.length < 1) { setFamilyResults([]); return; }
    familyTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/roster-registration/devotees?q=${encodeURIComponent(term)}`);
        const data = await res.json();
        setFamilyResults(Array.isArray(data.results) ? data.results : []);
      } catch { /* 忽略 */ }
    }, 300);
  }

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
    if (publicSlug) return; // 公開報名一律新資料，不查既有信眾。
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const term = q.trim();
    if (term.length < 1) { setResults((p) => ({ ...p, [i]: [] })); return; }
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
      existingYearReg: r.yearRegistrations ?? "",
    });
    setResults((p) => ({ ...p, [i]: [] }));
  }
  function clearExisting(i: number) {
    update(i, { existingMemberId: "", existingLabel: "", householdId: "", name: "", address: "", existingLunar: "", existingAge: "", existingZodiac: "", existingYearReg: "" });
  }

  async function submit() {
    setError(null);
    setOkMsg(null);
    const people = rows
      .map((r) => {
        const lanterns: { itemKey: "LANTERN_GUANGMING" | "LANTERN_TAISUI" | "LANTERN_PURIFICATION"; quantity: number }[] = [];
        if (r.guangming) lanterns.push({ itemKey: "LANTERN_GUANGMING", quantity: Number(r.guangmingQty) > 0 ? Number(r.guangmingQty) : 1 });
        if (r.taisui) lanterns.push({ itemKey: "LANTERN_TAISUI", quantity: Number(r.taisuiQty) > 0 ? Number(r.taisuiQty) : 1 });
        if (r.purification) lanterns.push({ itemKey: "LANTERN_PURIFICATION", quantity: 1 });
        return {
          existingMemberId: r.existingMemberId.trim() || null,
          name: r.name.trim() || null,
          phone: r.phone.trim() || null,
          address: r.address.trim() || null,
          gender: r.gender.trim() || null,
          solarBirthDate: r.solarBirthDate.trim() || null,
          lanterns,
        };
      })
      .filter((p) => (p.existingMemberId || p.name) && p.lanterns.length > 0);
    // 報名必填：姓名、生日、地址、性別。新填的信眾（沒選既有）都要齊；祭改一定要性別（小人頭要分男女）。
    for (let i = 0; i < people.length; i++) {
      const p = people[i];
      const needsPurification = p.lanterns.some((l) => l.itemKey === "LANTERN_PURIFICATION");
      if (!p.existingMemberId) {
        const miss: string[] = [];
        if (!p.name) miss.push("姓名");
        if (!p.solarBirthDate) miss.push("生日");
        if (!p.address) miss.push("地址");
        if (!p.gender) miss.push("性別");
        if (miss.length > 0) { setError(`第 ${i + 1} 位還缺：${miss.join("、")}（點燈需要姓名、生日、地址、性別）`); return; }
      } else if (needsPurification && !p.gender) {
        setError(`第 ${i + 1} 位報祭改需要性別（小人頭要分男女），請補選性別`); return;
      }
    }

    // 全家燈組裝。
    let family: unknown = null;
    if (familyOn) {
      if (publicSlug) {
        const members = famMembers.map((m) => ({ name: m.name.trim(), solarBirthDate: m.solarBirthDate.trim(), gender: m.gender.trim() })).filter((m) => m.name);
        if (members.length === 0 || !famContact.address.trim()) { setError("全家燈：請填戶長／家人姓名、每位生日性別，以及家戶地址"); return; }
        for (const m of members) {
          if (!m.solarBirthDate) { setError(`全家燈家人「${m.name}」還缺生日（點燈需要生日）`); return; }
          if (!m.gender) { setError(`全家燈家人「${m.name}」還缺性別`); return; }
        }
        family = { household: { contactName: famContact.name.trim() || members[0].name, address: famContact.address.trim(), phone: famContact.phone.trim() || null }, members };
      } else {
        if (!familyMemberId) { setError("全家燈：請先搜尋並選一位既有信眾（全家燈會涵蓋他的整戶）"); return; }
        family = { existingMemberId: familyMemberId };
      }
    }

    if (people.length === 0 && !family) { setError("請至少一位點光明／太歲燈，或加報全家燈"); return; }

    setBusy(true);
    try {
      const res = publicSlug
        ? await fetch(`/api/public-reg/${encodeURIComponent(publicSlug)}/submit`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "LANTERN", people, family }),
          })
        : await fetch(`/api/annual-lantern-registration`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, templeEventId, people, family, confirm: true }),
          });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "報名失敗，請稍後再試一次。"); return; }
      setOkMsg(publicSlug ? "已送出點燈報名！廟方核對後就會正式成立，感謝您。" : (data.message ?? "已完成點燈報名。"));
      setRows([emptyRow()]);
      setResults({});
      setFamilyOn(false); setFamilyMemberId(""); setFamilyMemberLabel(""); setFamilySearch(""); setFamilyResults([]);
      setFamContact({ name: "", phone: "", address: "" }); setFamMembers([{ name: "", solarBirthDate: "", gender: "" }]);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-3xl bg-white/70 p-6 shadow-card">
        <h1 className="text-lg text-ink">{activityName}・{publicSlug ? "線上點燈報名" : "現場快速點燈"}</h1>
        <p className="mt-1 text-sm text-ink-soft">
          可幫家人朋友一起點（多列）。每位勾選要點的燈（光明燈／太歲燈可複選）並填份數。
          <b className="text-ink">點燈需要姓名、生日、地址</b>（用來算歲數、生肖）。
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
                      <a href={`/household/${r.householdId}`} className="rounded-full bg-mist-100 px-3 py-1 text-xs text-ink-soft hover:bg-mist-200">🏠 進這一戶完整報名（選家人／全戶點燈）</a>
                    )}
                    <button type="button" onClick={() => clearExisting(i)} className="text-xs text-ink-faint hover:underline">改填新的 / 換一位</button>
                  </div>
                  {/* V41 重複報名提示：這個人今年已報名的項目（同姓名同項目就別再報第二筆）。 */}
                  {r.existingYearReg && (
                    <p className="rounded-lg bg-blossom-50 px-2 py-1 text-xs font-medium text-blossom-500">
                      ⚠️ 這個人今年已報名：{r.existingYearReg}（同項目不會再建立第二筆）
                    </p>
                  )}
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
                    <span className={labelClass}>姓名 <span className="text-blossom-500">＊必填</span>{publicSlug ? "" : "（打字可搜既有信眾）"}</span>
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
                      <span className={labelClass}>國曆生日 <span className="text-blossom-500">＊必填</span></span>
                      <input type="date" className={inputClass} value={r.solarBirthDate} onChange={(e) => update(i, { solarBirthDate: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>電話（選填）</span>
                      <input className={inputClass} value={r.phone} onChange={(e) => update(i, { phone: e.target.value })} />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className={labelClass}>性別 <span className="text-blossom-500">＊必填</span></span>
                      <select className={inputClass} value={r.gender} onChange={(e) => update(i, { gender: e.target.value })}>
                        <option value="">請選擇</option>
                        <option value="男">男</option>
                        <option value="女">女</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 sm:col-span-2">
                      <span className={labelClass}>地址 <span className="text-blossom-500">＊必填</span></span>
                      <input className={inputClass} value={r.address} onChange={(e) => update(i, { address: e.target.value })} />
                    </label>
                  </div>
                </>
              )}

              {/* 既有信眾也顯示性別（祭改要分男女；空白代表沿用信眾資料）。 */}
              {r.existingMemberId && (
                <label className="mt-2 flex items-center gap-2 text-sm text-ink">
                  <span className={labelClass}>性別</span>
                  <select className={`${inputClass} w-28`} value={r.gender} onChange={(e) => update(i, { gender: e.target.value })}>
                    <option value="">沿用信眾資料</option>
                    <option value="男">男</option>
                    <option value="女">女</option>
                  </select>
                </label>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-4 rounded-xl bg-white/70 px-4 py-3">
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={r.guangming} onChange={(e) => update(i, { guangming: e.target.checked })} />
                  光明燈
                </label>
                {r.guangming && (
                  <label className="flex items-center gap-1 text-xs text-ink-soft">
                    份數 <input type="number" min={1} className={`${inputClass} w-20`} value={r.guangmingQty} onChange={(e) => update(i, { guangmingQty: e.target.value })} />
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={r.taisui} onChange={(e) => update(i, { taisui: e.target.checked })} />
                  太歲燈
                </label>
                {r.taisui && (
                  <label className="flex items-center gap-1 text-xs text-ink-soft">
                    份數 <input type="number" min={1} className={`${inputClass} w-20`} value={r.taisuiQty} onChange={(e) => update(i, { taisuiQty: e.target.value })} />
                  </label>
                )}
                <label className="flex items-center gap-2 text-sm text-ink">
                  <input type="checkbox" checked={r.purification} onChange={(e) => update(i, { purification: e.target.checked })} />
                  祭改（小人頭）
                </label>
              </div>
            </div>
          ))}
        </div>

        {/* 全家燈（整戶一份、固定價） */}
        <div className="mt-4 rounded-2xl border border-cream-200 bg-white/60 p-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={familyOn} onChange={(e) => { setFamilyOn(e.target.checked); setOkMsg(null); }} />
            加報全家燈（整戶一份）
          </label>
          {familyOn && (publicSlug ? (
            <div className="mt-3 flex flex-col gap-3">
              <p className="text-xs text-ink-faint">全家燈整戶一份。請填家戶地址與全家成員（每位姓名＋生日，用來算歲數、生肖）。</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>戶長姓名（選填，預設用第一位）</span>
                  <input className={inputClass} value={famContact.name} onChange={(e) => setFamContact({ ...famContact, name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelClass}>電話（選填）</span>
                  <input className={inputClass} value={famContact.phone} onChange={(e) => setFamContact({ ...famContact, phone: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1 sm:col-span-2">
                  <span className={labelClass}>家戶地址 <span className="text-blossom-500">＊必填</span></span>
                  <input className={inputClass} value={famContact.address} onChange={(e) => setFamContact({ ...famContact, address: e.target.value })} />
                </label>
              </div>
              <div className="flex flex-col gap-2">
                <span className={labelClass}>全家成員（每位姓名＋國曆生日＋性別）</span>
                {famMembers.map((m, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2">
                    <input className={`${inputClass} flex-1`} placeholder={`第 ${i + 1} 位姓名`} value={m.name} onChange={(e) => setFamMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, name: e.target.value } : x))} />
                    <input type="date" className={inputClass} value={m.solarBirthDate} onChange={(e) => setFamMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, solarBirthDate: e.target.value } : x))} />
                    <select className={`${inputClass} w-24`} value={m.gender} onChange={(e) => setFamMembers((prev) => prev.map((x, idx) => idx === i ? { ...x, gender: e.target.value } : x))}>
                      <option value="">性別</option>
                      <option value="男">男</option>
                      <option value="女">女</option>
                    </select>
                    {famMembers.length > 1 && <button type="button" onClick={() => setFamMembers((prev) => prev.filter((_, idx) => idx !== i))} className="text-xs text-blossom-500 hover:underline">移除</button>}
                  </div>
                ))}
                <button type="button" onClick={() => setFamMembers((prev) => [...prev, { name: "", solarBirthDate: "", gender: "" }])} className="self-start text-xs text-sage-500 hover:underline">＋ 再加一位家人</button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex flex-col gap-2">
              <p className="text-xs text-ink-faint">全家燈整戶一份。搜尋並選一位既有信眾，全家燈會涵蓋他的整戶（在世成員）。</p>
              {familyMemberId ? (
                <div className="flex flex-wrap items-center gap-3 rounded-xl bg-sage-50 px-4 py-2.5">
                  <span className="text-sm text-ink">全家燈涵蓋：<b>{familyMemberLabel}</b> 的整戶</span>
                  <button type="button" onClick={() => { setFamilyMemberId(""); setFamilyMemberLabel(""); setFamilySearch(""); }} className="text-xs text-ink-faint hover:underline">換一位</button>
                </div>
              ) : (
                <>
                  <input className={inputClass} value={familySearch} onChange={(e) => void familyDoSearch(e.target.value)} placeholder="搜尋既有信眾姓名" />
                  {familyResults.length > 0 && (
                    <div className="max-h-40 overflow-auto rounded-xl border border-cream-200 bg-white">
                      {familyResults.map((res) => (
                        <button key={res.memberId} type="button" onClick={() => { setFamilyMemberId(res.memberId); setFamilyMemberLabel(`${res.name}（${res.householdName}）`); setFamilyResults([]); }} className="block w-full px-3 py-2 text-left text-sm text-ink hover:bg-cream-100">
                          {res.name}　<span className="text-xs text-ink-faint">{res.householdName}{res.address ? `・${res.address}` : ""}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={addRow} className={secondaryButtonClass}>＋ 再加一位</button>
          <button type="button" onClick={() => void submit()} disabled={busy} className={primaryButtonClass}>
            {busy ? (publicSlug ? "送出中…" : "報名中…") : (publicSlug ? "送出點燈報名" : "完成點燈")}
          </button>
          {okMsg && <span className="text-sm text-sage-500">{okMsg}</span>}
        </div>
        {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
        <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
          {publicSlug
            ? "送出後會進入廟方的「待確認清單」，由廟方核對後才正式成立、不會馬上收款。感謝您的報名。"
            : "送出即建立正式報名（金額＝該年度光明／太歲單價 × 份數）。若顯示應收 0，請先到活動頁設定年度燈單價。新信眾會自動建檔。"}
        </p>
      </section>
    </div>
  );
}
