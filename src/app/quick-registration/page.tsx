"use client";

import { useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V38 現場快速報名（中元普渡）。一頁三步：報名人 → 勾要報什麼 → 一鍵完成。
 * 打破舊手動流程的卡點：陽上人直接打名字（新家戶不卡）、報名成員自動帶報名人、
 * 地址依規則自動帶（冤親＝報名人個人地址；祖先／乙位正魂＝各自安奉地）。
 */

type Activity = { templeEventId: string; year: number; name: string; canRegister: boolean };
type DevoteeHit = { memberId: string; name: string; householdId: string; householdName: string; address: string | null; lunarBirthDisplay: string | null; nominalAge: number | null; zodiac: string | null; solarBirthDate: string | null };

type NamedRow = { displayName: string; yangshang: string; tabletAddress: string; pocketQty: string; pocketNames: string };
type UnbornRow = { mainText: "無緣子女" | "本宅地基主"; yangshang: string; tabletAddress: string };

export default function QuickRegistrationPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <Inner />
      </div>
    </OperatorProvider>
  );
}

const card = "rounded-2xl bg-white/70 p-5 shadow-card";
const inputCls = "rounded-lg border border-mist-200 px-3 py-2 text-sm";
const smallBtn = "rounded-full bg-mist-200 px-3 py-1 text-xs text-ink disabled:opacity-40";

function Inner() {
  // ── 活動 ──
  const [activities, setActivities] = useState<Activity[]>([]);
  const [templeEventId, setTempleEventId] = useState("");

  // ── 報名人 ──
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [existing, setExisting] = useState<DevoteeHit | null>(null);
  const [hits, setHits] = useState<DevoteeHit[]>([]);
  const [searching, setSearching] = useState(false);
  // 生日（選填）
  const [birthdayType, setBirthdayType] = useState<"" | "SOLAR" | "LUNAR">("");
  const [solarDate, setSolarDate] = useState("");
  const [lunarY, setLunarY] = useState("");
  const [lunarM, setLunarM] = useState("");
  const [lunarD, setLunarD] = useState("");
  const [lunarLeap, setLunarLeap] = useState(false);

  // ── 類別 ──
  const [ancestors, setAncestors] = useState<NamedRow[]>([]);
  const [souls, setSouls] = useState<NamedRow[]>([]);
  const [creditor, setCreditor] = useState(false);
  const [creditorYang, setCreditorYang] = useState("");
  const [unborn, setUnborn] = useState<UnbornRow[]>([]);
  const [riceKg, setRiceKg] = useState("");
  const [riceName, setRiceName] = useState("");
  const [masterName, setMasterName] = useState("");
  const [masterAmount, setMasterAmount] = useState("");
  const [sponsorQty, setSponsorQty] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [donation, setDonation] = useState("");
  const [donationName, setDonationName] = useState("");

  const [confirm, setConfirm] = useState(true);
  const [lastSig, setLastSig] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchRegistration("/api/quick-registration");
        const data = await res.json();
        if (res.ok && Array.isArray(data.activities)) {
          setActivities(data.activities);
          const open = data.activities.find((a: Activity) => a.canRegister) ?? data.activities[0];
          if (open) setTempleEventId(open.templeEventId);
        }
      } catch { /* 靜默：畫面上仍可手動重試 */ }
    })();
  }, []);

  // V38：打字即時查既有信眾（不用按按鈕）。已選既有信眾時不查；輸入變動 300ms 後查一次。
  useEffect(() => {
    if (existing) return;
    const q = name.trim();
    if (!q) { setHits([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetchRegistration(`/api/quick-registration/devotees?q=${encodeURIComponent(q)}`);
        const data = await res.json();
        setHits(res.ok ? (data.results ?? []) : []);
      } catch { setHits([]); } finally { setSearching(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [name, existing]);

  function pick(h: DevoteeHit) {
    setExisting(h);
    setName(h.name);
    setAddress(h.address ?? "");
    setHits([]);
  }
  function clearExisting() { setExisting(null); }

  function addAncestor() { setAncestors((a) => [...a, { displayName: "", yangshang: "", tabletAddress: "", pocketQty: "", pocketNames: "" }]); }
  function addSoul() { setSouls((a) => [...a, { displayName: "", yangshang: "", tabletAddress: "", pocketQty: "", pocketNames: "" }]); }
  function addUnborn() { setUnborn((a) => [...a, { mainText: "無緣子女", yangshang: "", tabletAddress: "" }]); }

  const splitYang = (s: string) => s.split(/[,、，\s]+/).map((x) => x.trim()).filter(Boolean);

  function validate(): string | null {
    if (!templeEventId) return "請先選擇活動年度。";
    if (!existing && !name.trim()) return "請輸入報名人姓名。";
    const anySelected =
      ancestors.some((a) => a.displayName.trim()) ||
      souls.some((a) => a.displayName.trim()) ||
      creditor ||
      unborn.length > 0 ||
      ancestors.some((a) => Number(a.pocketQty) > 0 || a.pocketNames.trim()) ||
      souls.some((a) => Number(a.pocketQty) > 0 || a.pocketNames.trim()) ||
      Number(riceKg) > 0 || Number(sponsorQty) > 0 || Number(donation) > 0;
    if (!anySelected) return "請至少勾選一個要報名的項目。";
    return null;
  }

  async function submit() {
    const v = validate();
    if (v) { setError(v); return; }
    const registrant: any = existing
      ? { existingMemberId: existing.memberId, address: address.trim() || null }
      : { name: name.trim(), address: address.trim() || null };
    if (!existing && birthdayType === "SOLAR" && solarDate) {
      registrant.birthdayType = "SOLAR"; registrant.solarBirthDate = solarDate;
    } else if (!existing && birthdayType === "LUNAR" && lunarY) {
      registrant.birthdayType = "LUNAR";
      registrant.lunarBirthYear = Number(lunarY) || null;
      registrant.lunarBirthMonth = Number(lunarM) || null;
      registrant.lunarBirthDay = Number(lunarD) || null;
      registrant.lunarIsLeapMonth = lunarLeap;
    }
    const body = {
      templeEventId,
      registrant,
      ancestors: ancestors.filter((a) => a.displayName.trim()).map((a) => ({ displayName: a.displayName.trim(), yangshangNames: splitYang(a.yangshang), tabletAddress: a.tabletAddress.trim() || null, extraPocketQty: Number(a.pocketQty) > 0 ? Math.floor(Number(a.pocketQty)) : null, extraPocketNames: splitYang(a.pocketNames) })),
      individualSouls: souls.filter((a) => a.displayName.trim()).map((a) => ({ displayName: a.displayName.trim(), yangshangNames: splitYang(a.yangshang), tabletAddress: a.tabletAddress.trim() || null, extraPocketQty: Number(a.pocketQty) > 0 ? Math.floor(Number(a.pocketQty)) : null, extraPocketNames: splitYang(a.pocketNames) })),
      creditor: creditor ? { include: true, yangshangNames: splitYang(creditorYang) } : null,
      unborn: unborn.map((u) => ({ mainText: u.mainText, yangshangNames: splitYang(u.yangshang), tabletAddress: u.tabletAddress.trim() || null })),
      riceKg: Number(riceKg) > 0 ? Number(riceKg) : null,
      riceName: riceName.trim() || null,
      sponsorQty: Number(sponsorQty) > 0 ? Math.floor(Number(sponsorQty)) : null,
      sponsorName: sponsorName.trim() || null,
      donationAmount: Number(donation) > 0 ? Math.round(Number(donation)) : null,
      donationName: donationName.trim() || null,
      confirm,
    };
    // 防呆：與「剛剛才成功送出的那一筆」內容一模一樣 → 先問，避免手滑按兩次建重複。
    const sig = JSON.stringify({ ...body, confirm: undefined });
    if (sig === lastSig && !window.confirm("剛剛已經送出過『一模一樣』的報名內容，確定要再報一筆嗎？")) return;
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await fetchRegistration("/api/quick-registration", { method: "POST", body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(toFriendlyError(res.status, data?.error)); return; }
      setResult(data); setLastSig(sig);
      // 供師（不進財務）：主報名成立後，若有填供師姓名就另存一筆到供師名單。
      if (masterName.trim()) {
        const yr = activities.find((a) => a.templeEventId === templeEventId)?.year;
        try {
          await fetchRegistration("/api/master-offering", {
            method: "POST",
            body: JSON.stringify({ year: yr, name: masterName.trim(), amount: Number(masterAmount) || 0, householdId: data?.householdId ?? null }),
          });
          setMasterName(""); setMasterAmount("");
        } catch { /* 供師另存失敗不影響主報名；可到供師名單頁補登 */ }
      }
    } catch { setError("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  function resetAll() {
    setName(""); setAddress(""); setExisting(null); setHits([]);
    setBirthdayType(""); setSolarDate(""); setLunarY(""); setLunarM(""); setLunarD(""); setLunarLeap(false);
    setAncestors([]); setSouls([]); setCreditor(false); setCreditorYang(""); setUnborn([]);
    setRiceKg(""); setRiceName(""); setSponsorQty(""); setSponsorName(""); setDonation(""); setDonationName(""); setMasterName(""); setMasterAmount(""); setResult(null); setError(null); setLastSig(null);
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-lg text-ink">現場快速報名（中元普渡）</h1>
        <p className="mt-1 text-sm text-ink-soft">報名人 → 勾要報什麼 → 一鍵完成。陽上人直接打名字即可（不用先建成員）；報名成員會自動帶報名人。</p>
      </div>

      {/* 活動：宮裡同時只辦一個活動，自動帶入目前辦理的那個，不用選。 */}
      <section className={card}>
        <h2 className="text-base font-medium text-ink">活動</h2>
        {(() => {
          const cur = activities.find((a) => a.templeEventId === templeEventId);
          if (cur) {
            return <p className="mt-2 text-sm text-ink">民國 {cur.year} 年・{cur.name} <span className="text-ink-faint">（自動帶入目前辦理的活動）</span></p>;
          }
          if (activities.length === 0) {
            return <p className="mt-2 text-sm text-blossom-500">目前沒有開放報名的活動，請先於「活動管理」建立／開放中元普渡活動。</p>;
          }
          return (
            <select value={templeEventId} onChange={(e) => setTempleEventId(e.target.value)} className={`mt-2 w-full ${inputCls}`}>
              <option value="">請選擇活動…</option>
              {activities.map((a) => (
                <option key={a.templeEventId} value={a.templeEventId}>民國 {a.year} 年・{a.name}{a.canRegister ? "" : "（未開放）"}</option>
              ))}
            </select>
          );
        })()}
      </section>

      {/* ① 報名人 */}
      <section className={card}>
        <h2 className="text-base font-medium text-ink">① 報名人</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">姓名{searching && <span className="text-ink-faint">（搜尋中…）</span>}</span>
            <input value={name} onChange={(e) => { setName(e.target.value); setExisting(null); }} placeholder="打字即時查既有信眾（例：王小明）" className={inputCls} />
          </label>
          {hits.length > 0 && !existing && (
            <div className="rounded-lg border border-mist-200 bg-cream-50 p-2 flex flex-col gap-1 max-h-48 overflow-auto">
              <p className="text-xs text-ink-soft">選一位既有信眾帶入（或直接忽略、用新信眾建立）：</p>
              {hits.map((h) => (
                <button type="button" key={h.memberId} onClick={() => pick(h)} className="text-left text-xs rounded px-2 py-1 hover:bg-white/70">
                  <b className="text-ink">{h.name}</b>｜{h.householdName}｜{h.address ?? "無地址"}
                </button>
              ))}
            </div>
          )}
          {existing && (
            <div className="flex flex-col gap-1 rounded-xl bg-emerald-50/60 px-3 py-2 ring-1 ring-emerald-100">
              <p className="text-xs text-emerald-700">已帶入既有信眾：<b>{existing.name}</b>（{existing.householdName}）
                {existing.householdId && (
                  <a href={`/household/${existing.householdId}`} className="ml-2 rounded-full bg-mist-100 px-3 py-1 text-ink-soft hover:bg-mist-200">🏠 進這一戶完整報名（選家人／既有牌位）</a>
                )}
                <button type="button" onClick={clearExisting} className="ml-2 text-ink-soft underline">改用新信眾</button>
              </p>
              {/* V41 現場核對（唯讀）：姓名／農曆生日／歲數（生肖）／地址，資料有誤進家戶頁改。 */}
              <p className="text-xs text-ink-soft">
                核對資料　農曆生日：<b className="text-ink">{existing.lunarBirthDisplay ?? "未登記"}</b>
                　｜　歲數：<b className="text-ink">{existing.nominalAge != null ? `虛歲 ${existing.nominalAge}` : "未登記"}</b>
                {existing.zodiac ? `（生肖 ${existing.zodiac}）` : ""}
                　｜　地址：<b className="text-ink">{existing.address ?? "未登記"}</b>
              </p>
              <p className="text-[11px] text-ink-faint">資料有誤請按「🏠 進這一戶完整報名」到家戶頁修改（此處唯讀）。</p>
            </div>
          )}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ink-soft">地址（冤親牌位會用這個地址；祖先／正魂用各自安奉地）</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="例：台北市中正區…" className={inputCls} />
          </label>
          {!existing && (
            <div className="flex flex-col gap-2">
              <span className="text-xs text-ink-soft">出生年月日（選填）</span>
              <div className="flex gap-2 items-center text-sm">
                <select value={birthdayType} onChange={(e) => setBirthdayType(e.target.value as any)} className={inputCls}>
                  <option value="">不填</option>
                  <option value="SOLAR">國曆</option>
                  <option value="LUNAR">農曆</option>
                </select>
                {birthdayType === "SOLAR" && (
                  <input type="date" value={solarDate} onChange={(e) => setSolarDate(e.target.value)} className={inputCls} />
                )}
                {birthdayType === "LUNAR" && (
                  <div className="flex gap-1 items-center">
                    <input value={lunarY} onChange={(e) => setLunarY(e.target.value)} placeholder="民國年" className={`w-20 ${inputCls}`} />
                    <input value={lunarM} onChange={(e) => setLunarM(e.target.value)} placeholder="月" className={`w-14 ${inputCls}`} />
                    <input value={lunarD} onChange={(e) => setLunarD(e.target.value)} placeholder="日" className={`w-14 ${inputCls}`} />
                    <label className="flex items-center gap-1 text-xs text-ink-soft"><input type="checkbox" checked={lunarLeap} onChange={(e) => setLunarLeap(e.target.checked)} />閏月</label>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ② 要報名什麼 */}
      <section className={card}>
        <h2 className="text-base font-medium text-ink">② 要報名什麼</h2>
        <p className="mt-1 text-xs text-ink-faint">＊「增加寶袋」在每一列<b>歷代祖先／乙位正魂</b>的下面——先按該類的「＋加一筆」，展開後就能各自填寶袋份數／姓名（可多張各自加）。</p>

        {/* 歷代祖先 */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">歷代祖先</span>
            <button type="button" onClick={addAncestor} className={smallBtn}>＋ 加一筆</button>
          </div>
          {ancestors.map((a, i) => (
            <div key={i} className="mt-2 rounded-lg bg-cream-50 p-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input value={a.displayName} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, displayName: e.target.value } : r))} placeholder="姓（例：王）" className={inputCls} />
                <input value={a.yangshang} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（多位用、隔開）" className={inputCls} />
                <div className="flex gap-1">
                  <input value={a.tabletAddress} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, tabletAddress: e.target.value } : r))} placeholder="安奉地" className={`flex-1 ${inputCls}`} />
                  <button type="button" onClick={() => setAncestors((x) => x.filter((_, j) => j !== i))} className="text-xs text-blossom-500 px-1">刪</button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={a.pocketQty} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, pocketQty: e.target.value } : r))} inputMode="numeric" placeholder="增加寶袋份數（可留空）" className={inputCls} />
                <input value={a.pocketNames} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, pocketNames: e.target.value } : r))} placeholder="寶袋指定姓名（每名一份，用、隔開）" className={inputCls} />
              </div>
            </div>
          ))}
        </div>

        {/* 乙位正魂 */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">乙位正魂</span>
            <button type="button" onClick={addSoul} className={smallBtn}>＋ 加一筆</button>
          </div>
          {souls.map((a, i) => (
            <div key={i} className="mt-2 rounded-lg bg-cream-50 p-2">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input value={a.displayName} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, displayName: e.target.value } : r))} placeholder="往生者姓名" className={inputCls} />
                <input value={a.yangshang} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（多位用、隔開）" className={inputCls} />
                <div className="flex gap-1">
                  <input value={a.tabletAddress} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, tabletAddress: e.target.value } : r))} placeholder="安奉地" className={`flex-1 ${inputCls}`} />
                  <button type="button" onClick={() => setSouls((x) => x.filter((_, j) => j !== i))} className="text-xs text-blossom-500 px-1">刪</button>
                </div>
              </div>
              <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input value={a.pocketQty} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, pocketQty: e.target.value } : r))} inputMode="numeric" placeholder="增加寶袋份數（可留空）" className={inputCls} />
                <input value={a.pocketNames} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, pocketNames: e.target.value } : r))} placeholder="寶袋指定姓名（每名一份，用、隔開）" className={inputCls} />
              </div>
            </div>
          ))}
        </div>

        {/* 累世冤親債主 */}
        <div className="mt-4">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={creditor} onChange={(e) => setCreditor(e.target.checked)} />
            累世冤親債主
          </label>
          {creditor && (
            <input value={creditorYang} onChange={(e) => setCreditorYang(e.target.value)} placeholder="陽上人（留空＝用報名人）" className={`mt-2 w-full ${inputCls}`} />
          )}
        </div>

        {/* 無緣子女／地基主 */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">無緣子女／本宅地基主</span>
            <button type="button" onClick={addUnborn} className={smallBtn}>＋ 加一筆</button>
          </div>
          {unborn.map((u, i) => (
            <div key={i} className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <select value={u.mainText} onChange={(e) => setUnborn((x) => x.map((r, j) => j === i ? { ...r, mainText: e.target.value as any } : r))} className={inputCls}>
                <option value="無緣子女">無緣子女</option>
                <option value="本宅地基主">本宅地基主</option>
              </select>
              <input value={u.yangshang} onChange={(e) => setUnborn((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（留空＝用報名人）" className={inputCls} />
              <div className="flex gap-1">
                <input value={u.tabletAddress} onChange={(e) => setUnborn((x) => x.map((r, j) => j === i ? { ...r, tabletAddress: e.target.value } : r))} placeholder="地址（留空＝報名人地址）" className={`flex-1 ${inputCls}`} />
                <button type="button" onClick={() => setUnborn((x) => x.filter((_, j) => j !== i))} className="text-xs text-blossom-500 px-1">刪</button>
              </div>
            </div>
          ))}
        </div>

        {/* 白米／贊普／隨喜 */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">白米（斤）</span>
            <input value={riceKg} onChange={(e) => setRiceKg(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">白米認購人（可填公司名，留空＝報名人）</span>
            <input value={riceName} onChange={(e) => setRiceName(e.target.value)} placeholder="留空＝報名人姓名" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">贊普（數量）</span>
            <input value={sponsorQty} onChange={(e) => setSponsorQty(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">贊普認購人（可填公司名，留空＝報名人）</span>
            <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="留空＝報名人姓名" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">大額贊普（金額自填）</span>
            <input value={donation} onChange={(e) => setDonation(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">大額贊普認購人（可填公司名，留空＝報名人）</span>
            <input value={donationName} onChange={(e) => setDonationName(e.target.value)} placeholder="留空＝報名人姓名" className={inputCls} /></label>
        </div>

        {/* 供師（不進財務；金額自填、繳費之後在供師名單頁勾） */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">供師姓名（不進財務，選填）</span>
            <input value={masterName} onChange={(e) => setMasterName(e.target.value)} placeholder="留空＝不報供師" className={inputCls} /></label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">供師金額（自填）</span>
            <input value={masterAmount} onChange={(e) => setMasterAmount(e.target.value)} inputMode="numeric" placeholder="0" className={inputCls} /></label>
        </div>
      </section>

      {/* ③ 完成 */}
      <section className={card}>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
          送出後直接確認報名（可立即列印）；若有缺欄位會保留草稿，稍後到報名頁補齊
        </label>
        {error && <p className="mt-3 text-sm text-blossom-500">⚠️ {error}</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy} onClick={submit}
            style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }}
            className="rounded-full px-6 py-2 text-sm font-semibold">
            {busy ? "處理中…" : "完成報名"}
          </button>
          <button type="button" disabled={busy} onClick={resetAll} className="rounded-full bg-mist-200 px-4 py-2 text-sm text-ink disabled:opacity-40">清空重填</button>
        </div>

        {result?.ok && (
          <div className="mt-4 rounded-xl bg-emerald-50 p-4 text-sm ring-1 ring-emerald-200">
            <p className="text-emerald-800 font-medium">
              {result.confirmed ? "✅ 報名完成並已確認！" : "✅ 已建立報名（草稿）"}
              ｜共 {result.createdTablets} 張牌位
            </p>
            {!result.confirmed && result.confirmError && (
              <p className="mt-1 text-blossom-500">尚未確認：{result.confirmError}（可到報名頁補齊後確認）</p>
            )}
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <a href={`/registration/${result.ritualRecordId}`} className="text-emerald-700 underline">開啟這筆報名（檢視／列印）→</a>
              <a href={`/household/${result.householdId}`} className="text-ink-soft underline">開啟家戶 →</a>
              <button type="button" onClick={resetAll} className="text-ink-soft underline">再報下一位 →</button>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
