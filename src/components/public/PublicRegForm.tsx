"use client";

import { useMemo, useState } from "react";
import type { PublicFormView } from "@/lib/publicReg";

/**
 * V38 信眾公開報名表單（免登入）。依活動設定顯示欄位＋金額，送出後顯示「已收到、待廟方確認」。
 * 不線上付款、不建正式牌位——只把資料送進「待確認」。
 */

type NamedRow = { displayName: string; yangshang: string; tabletAddress: string };
type UnbornRow = { mainText: "無緣子女" | "本宅地基主"; yangshang: string };

const input = "w-full rounded-lg border border-mist-200 px-3 py-2 text-base";
const card = "rounded-2xl bg-white/80 p-4 shadow-card";

type RiceQuota = { remainingKg: number; allowOverbook: boolean; open: boolean };

export default function PublicRegForm({ form, riceQuota }: { form: PublicFormView; riceQuota?: RiceQuota | null }) {
  const p = form.config.prices;
  const showPhone = form.config.fields.includes("phone");
  const showAddress = form.config.fields.includes("address");
  const showBirthday = form.config.fields.includes("birthday");

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [birthday, setBirthday] = useState("");

  const [ancestors, setAncestors] = useState<NamedRow[]>([]);
  const [souls, setSouls] = useState<NamedRow[]>([]);
  const [creditor, setCreditor] = useState(false);
  const [creditorYang, setCreditorYang] = useState("");
  const [unborn, setUnborn] = useState<UnbornRow[]>([]);
  const [riceKg, setRiceKg] = useState("");
  const [sponsorQty, setSponsorQty] = useState("");
  const [sponsorName, setSponsorName] = useState("");
  const [donation, setDonation] = useState("");
  const [donationName, setDonationName] = useState("");
  const [pocketQty, setPocketQty] = useState("");
  const [masterName, setMasterName] = useState("");
  const [masterAmount, setMasterAmount] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const tabletCount = useMemo(
    () => ancestors.filter((a) => a.displayName.trim()).length + souls.filter((a) => a.displayName.trim()).length + (creditor ? 1 : 0) + unborn.length,
    [ancestors, souls, creditor, unborn]
  );
  const amount = useMemo(() => {
    const rice = Number(riceKg) > 0 ? Number(riceKg) * p.ricePerJin : 0;
    const sponsor = Number(sponsorQty) > 0 ? Math.floor(Number(sponsorQty)) * p.sponsorPerUnit : 0;
    const don = Number(donation) > 0 ? Math.round(Number(donation)) : 0;
    const pocket = Number(pocketQty) > 0 ? Math.floor(Number(pocketQty)) * p.pocket : 0;
    const master = Number(masterAmount) > 0 ? Math.round(Number(masterAmount)) : 0;
    return tabletCount * p.tablet + rice + sponsor + don + pocket + master;
  }, [tabletCount, riceKg, sponsorQty, donation, pocketQty, masterAmount, p]);

  // V40 白米配額：open 且未開放超量時才限制；剩餘量不顯示負數；超出即擋送出。
  const riceLimited = !!riceQuota && riceQuota.open && !riceQuota.allowOverbook;
  const riceRemaining = riceQuota ? Math.max(0, riceQuota.remainingKg) : null;
  const riceOver = riceLimited && riceRemaining !== null && Number(riceKg) > riceRemaining;

  function addAncestor() { setAncestors((a) => [...a, { displayName: "", yangshang: "", tabletAddress: "" }]); }
  function addSoul() { setSouls((a) => [...a, { displayName: "", yangshang: "", tabletAddress: "" }]); }
  function addUnborn() { setUnborn((a) => [...a, { mainText: "無緣子女", yangshang: "" }]); }

  async function submit() {
    if (!name.trim()) { setError("請填寫報名人姓名"); return; }
    if (tabletCount === 0 && Number(riceKg) <= 0 && Number(sponsorQty) <= 0 && Number(donation) <= 0 && Number(pocketQty) <= 0 && !masterName.trim()) {
      setError("請至少選一項要報名的項目"); return;
    }
    if (Number(pocketQty) > 0 && tabletCount === 0) {
      setError("寶袋需搭配至少一張牌位（祖先／正魂／冤親／無緣），請先報一張牌位"); return;
    }
    if (riceOver) {
      setError(riceRemaining === 0 ? "白米已額滿，暫時無法認購" : `白米最多只剩 ${riceRemaining} 斤，請調整白米斤數`); return;
    }
    setBusy(true); setError(null);
    const payload = {
      registrant: { name: name.trim(), phone: phone.trim() || null, address: address.trim() || null, birthday: birthday.trim() || null },
      ancestors: ancestors.filter((a) => a.displayName.trim()).map((a) => ({ displayName: a.displayName.trim(), yangshang: a.yangshang.trim(), tabletAddress: a.tabletAddress.trim() })),
      souls: souls.filter((a) => a.displayName.trim()).map((a) => ({ displayName: a.displayName.trim(), yangshang: a.yangshang.trim(), tabletAddress: a.tabletAddress.trim() })),
      creditor,
      creditorYangshang: creditorYang.trim() || null,
      unborn: unborn.map((u) => ({ mainText: u.mainText, yangshang: u.yangshang.trim() })),
      riceKg: Number(riceKg) > 0 ? Number(riceKg) : null,
      sponsorQty: Number(sponsorQty) > 0 ? Math.floor(Number(sponsorQty)) : null,
      sponsorName: sponsorName.trim() || null,
      donationAmount: Number(donation) > 0 ? Math.round(Number(donation)) : null,
      donationName: donationName.trim() || null,
      pocketQty: Number(pocketQty) > 0 ? Math.floor(Number(pocketQty)) : null,
      masterName: masterName.trim() || null,
      masterAmount: Number(masterAmount) > 0 ? Math.round(Number(masterAmount)) : null,
    };
    try {
      const res = await fetch(`/api/public-reg/${encodeURIComponent(form.slug)}/submit`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) { setError(data?.error ?? "送出失敗，請稍後再試"); return; }
      setDone(true);
    } catch { setError("連線問題，請稍後再試"); } finally { setBusy(false); }
  }

  if (done) {
    return (
      <div className={`${card} text-center`}>
        <div className="text-3xl">🙏</div>
        <h1 className="mt-2 text-lg text-ink">已收到您的報名</h1>
        <p className="mt-2 text-sm text-ink-soft">感謝您，報名已送出，<b>待廟方核對確認</b>。金額請到宮裡繳納。如需修改請直接聯繫宮方。</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="text-xl text-ink">{form.activityName}</h1>
        <p className="mt-1 text-sm text-ink-soft">{form.headerNote || "線上報名 — 填寫後到宮裡繳費；送出僅為登記，待廟方確認。"}</p>
      </div>

      <section className={card}>
        <h2 className="text-base font-medium text-ink">① 報名人</h2>
        <div className="mt-2 flex flex-col gap-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名（必填）" className={input} />
          {showPhone && <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="電話" inputMode="tel" className={input} />}
          {showAddress && <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="地址" className={input} />}
          {showBirthday && <input value={birthday} onChange={(e) => setBirthday(e.target.value)} placeholder="出生年月日（選填）" className={input} />}
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-medium text-ink">② 要報名什麼</h2>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">歷代祖先 <span className="text-ink-faint">（每份 ${p.tablet}）</span></span>
            <button type="button" onClick={addAncestor} className="rounded-full bg-mist-200 px-3 py-1 text-xs text-ink">＋ 加一筆</button>
          </div>
          {ancestors.map((a, i) => (
            <div key={i} className="mt-2 rounded-lg bg-cream-50 p-2 flex flex-col gap-2">
              <input value={a.displayName} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, displayName: e.target.value } : r))} placeholder="姓（例：王）" className={input} />
              <input value={a.yangshang} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（多位用、隔開）" className={input} />
              <div className="flex gap-1">
                <input value={a.tabletAddress} onChange={(e) => setAncestors((x) => x.map((r, j) => j === i ? { ...r, tabletAddress: e.target.value } : r))} placeholder="安奉地" className={input} />
                <button type="button" onClick={() => setAncestors((x) => x.filter((_, j) => j !== i))} className="px-2 text-blossom-500">刪</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">乙位正魂 <span className="text-ink-faint">（每份 ${p.tablet}）</span></span>
            <button type="button" onClick={addSoul} className="rounded-full bg-mist-200 px-3 py-1 text-xs text-ink">＋ 加一筆</button>
          </div>
          {souls.map((a, i) => (
            <div key={i} className="mt-2 rounded-lg bg-cream-50 p-2 flex flex-col gap-2">
              <input value={a.displayName} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, displayName: e.target.value } : r))} placeholder="往生者姓名" className={input} />
              <input value={a.yangshang} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（多位用、隔開）" className={input} />
              <div className="flex gap-1">
                <input value={a.tabletAddress} onChange={(e) => setSouls((x) => x.map((r, j) => j === i ? { ...r, tabletAddress: e.target.value } : r))} placeholder="安奉地" className={input} />
                <button type="button" onClick={() => setSouls((x) => x.filter((_, j) => j !== i))} className="px-2 text-blossom-500">刪</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-3">
          <label className="flex items-center gap-2 text-sm font-medium text-ink">
            <input type="checkbox" checked={creditor} onChange={(e) => setCreditor(e.target.checked)} />
            累世冤親債主 <span className="text-ink-faint">（每份 ${p.tablet}）</span>
          </label>
          {creditor && <input value={creditorYang} onChange={(e) => setCreditorYang(e.target.value)} placeholder="陽上人（留空＝報名人）" className={`mt-2 ${input}`} />}
        </div>

        <div className="mt-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-ink">無緣子女／本宅地基主 <span className="text-ink-faint">（每份 ${p.tablet}）</span></span>
            <button type="button" onClick={addUnborn} className="rounded-full bg-mist-200 px-3 py-1 text-xs text-ink">＋ 加一筆</button>
          </div>
          {unborn.map((u, i) => (
            <div key={i} className="mt-2 rounded-lg bg-cream-50 p-2 flex flex-col gap-2">
              <select value={u.mainText} onChange={(e) => setUnborn((x) => x.map((r, j) => j === i ? { ...r, mainText: e.target.value as UnbornRow["mainText"] } : r))} className={input}>
                <option value="無緣子女">無緣子女</option>
                <option value="本宅地基主">本宅地基主</option>
              </select>
              <div className="flex gap-1">
                <input value={u.yangshang} onChange={(e) => setUnborn((x) => x.map((r, j) => j === i ? { ...r, yangshang: e.target.value } : r))} placeholder="陽上人（留空＝報名人）" className={input} />
                <button type="button" onClick={() => setUnborn((x) => x.filter((_, j) => j !== i))} className="px-2 text-blossom-500">刪</button>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <label className="flex flex-col gap-1"><span className="text-sm text-ink">白米（斤）<span className="text-ink-faint">　每斤 ${p.ricePerJin}</span>
            {riceLimited && riceRemaining !== null && (
              <span className={`ml-1 text-xs ${riceRemaining === 0 ? "text-rose-600" : "text-ink-faint"}`}>
                {riceRemaining === 0 ? "（已額滿）" : `（剩餘 ${riceRemaining} 斤）`}
              </span>
            )}</span>
            <input value={riceKg} onChange={(e) => setRiceKg(e.target.value)} inputMode="numeric" placeholder="0" className={input} />
            {riceOver && <span className="text-xs text-rose-600">{riceRemaining === 0 ? "白米已額滿，暫時無法認購" : `超過剩餘量，白米最多只能認購 ${riceRemaining} 斤`}</span>}
          </label>
          <label className="flex flex-col gap-1"><span className="text-sm text-ink">贊普（數量）<span className="text-ink-faint">　每份 ${p.sponsorPerUnit}</span></span>
            <input value={sponsorQty} onChange={(e) => setSponsorQty(e.target.value)} inputMode="numeric" placeholder="0" className={input} /></label>
          {Number(sponsorQty) > 0 && <input value={sponsorName} onChange={(e) => setSponsorName(e.target.value)} placeholder="贊普認購人名稱（可填公司名，留空＝報名人）" className={input} />}
          <label className="flex flex-col gap-1"><span className="text-sm text-ink">大額贊普（金額自填）</span>
            <input value={donation} onChange={(e) => setDonation(e.target.value)} inputMode="numeric" placeholder="0" className={input} /></label>
          {Number(donation) > 0 && <input value={donationName} onChange={(e) => setDonationName(e.target.value)} placeholder="大額贊普認購人名稱（可填公司名，留空＝報名人）" className={input} />}
          <label className="flex flex-col gap-1"><span className="text-sm text-ink">寶袋（份）<span className="text-ink-faint">　每份 ${p.pocket}（需搭配牌位）</span></span>
            <input value={pocketQty} onChange={(e) => setPocketQty(e.target.value)} inputMode="numeric" placeholder="0" className={input} /></label>
        </div>
      </section>

      <section className={card}>
        <h2 className="text-base font-medium text-ink">③ 供師（選填）</h2>
        <p className="mt-1 text-xs text-ink-faint">金額自填，到宮裡繳納。</p>
        <div className="mt-2 flex flex-col gap-2">
          <input value={masterName} onChange={(e) => setMasterName(e.target.value)} placeholder="供師姓名（留空＝不報供師）" className={input} />
          {masterName.trim() && <input value={masterAmount} onChange={(e) => setMasterAmount(e.target.value)} inputMode="numeric" placeholder="供師金額（自填）" className={input} />}
        </div>
      </section>

      <div className={`${card} flex items-center justify-between`}>
        <span className="text-sm text-ink-soft">金額參考（現場繳費）</span>
        <span className="text-xl font-medium text-ink">${amount.toLocaleString()}</span>
      </div>

      {error && <p className="text-sm text-blossom-500 text-center">⚠️ {error}</p>}

      <button type="button" disabled={busy} onClick={submit}
        style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }}
        className="w-full rounded-full px-6 py-3 text-base font-semibold">
        {busy ? "送出中…" : "送出報名"}
      </button>
      <p className="text-center text-xs text-ink-faint">送出僅為登記，待廟方確認；不會線上扣款，金額到宮裡繳納。</p>
    </div>
  );
}
