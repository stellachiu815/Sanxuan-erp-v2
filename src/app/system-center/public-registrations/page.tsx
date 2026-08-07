"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * V38 信眾公開報名・後台：選活動 → 設定報名表（網址／欄位／金額）→ 產生網址＋QR → 待確認清單（確認即轉正式）。
 */

type Activity = { templeEventId: string; year: number; name: string; canRegister: boolean };
type FormView = { id: string; slug: string; templeEventId: string; year: number | null; activityName: string; isOpen: boolean; headerNote: string | null; config: { fields: string[]; prices: { tablet: number; ricePerJin: number; sponsorPerUnit: number; pocket: number } } };
type RegRow = { id: string; status: string; createdAt: string; payload: any };

export default function PublicRegAdminPage() {
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

function Inner() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [templeEventId, setTempleEventId] = useState("");
  const [slug, setSlug] = useState("");
  const [fields, setFields] = useState<{ phone: boolean; address: boolean; birthday: boolean }>({ phone: true, address: true, birthday: false });
  const [prices, setPrices] = useState({ tablet: "2500", ricePerJin: "32", sponsorPerUnit: "800", pocket: "300" });
  const [headerNote, setHeaderNote] = useState("");
  const [isOpen, setIsOpen] = useState(true);
  const [form, setForm] = useState<FormView | null>(null);
  const [rows, setRows] = useState<RegRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const qrRef = useRef<HTMLDivElement | null>(null);

  const publicUrl = form ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${encodeURIComponent(form.slug)}` : "";

  useEffect(() => {
    (async () => {
      try {
        const res = await fetchRegistration("/api/quick-registration");
        const d = await res.json();
        if (res.ok && Array.isArray(d.activities)) {
          setActivities(d.activities);
          if (d.activities[0]) setTempleEventId(d.activities[0].templeEventId);
        }
      } catch { /* ignore */ }
    })();
  }, []);

  const load = useCallback(async () => {
    if (!templeEventId) return;
    setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/public-reg?templeEventId=${templeEventId}`);
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setRows(d.rows ?? []);
      if (d.form) {
        setForm(d.form);
        setSlug(d.form.slug);
        setFields({ phone: d.form.config.fields.includes("phone"), address: d.form.config.fields.includes("address"), birthday: d.form.config.fields.includes("birthday") });
        setPrices({ tablet: String(d.form.config.prices.tablet), ricePerJin: String(d.form.config.prices.ricePerJin), sponsorPerUnit: String(d.form.config.prices.sponsorPerUnit), pocket: String(d.form.config.prices.pocket ?? 300) });
        setHeaderNote(d.form.headerNote ?? "");
        setIsOpen(d.form.isOpen);
      } else {
        setForm(null);
        const act = activities.find((a) => a.templeEventId === templeEventId);
        setSlug(act ? `普渡${act.year}` : "");
      }
    } catch { setErr("讀取失敗"); }
  }, [templeEventId, activities]);
  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (!publicUrl || !qrRef.current) return;
    const render = () => {
      const el = qrRef.current; const QR = (window as any).QRCode;
      if (!el || !QR) return;
      el.innerHTML = "";
      new QR(el, { text: publicUrl, width: 168, height: 168 });
    };
    if ((window as any).QRCode) { render(); return; }
    let sc = document.getElementById("qrcodejs-lib") as HTMLScriptElement | null;
    if (!sc) {
      sc = document.createElement("script");
      sc.id = "qrcodejs-lib";
      sc.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
      sc.onload = render;
      document.body.appendChild(sc);
    } else { sc.addEventListener("load", render); }
  }, [publicUrl]);

  async function saveForm() {
    if (!templeEventId) { setErr("請先選活動"); return; }
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration("/api/admin/public-reg", {
        method: "POST",
        body: JSON.stringify({
          action: "save-form", templeEventId, slug,
          fields: [fields.phone ? "phone" : null, fields.address ? "address" : null, fields.birthday ? "birthday" : null].filter(Boolean),
          prices: { tablet: Number(prices.tablet), ricePerJin: Number(prices.ricePerJin), sponsorPerUnit: Number(prices.sponsorPerUnit), pocket: Number(prices.pocket) },
          headerNote: headerNote.trim() || null, isOpen,
        }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setForm(d.form); setMsg("已儲存報名表，網址與 QR 已產生。");
    } catch { setErr("儲存失敗"); } finally { setBusy(false); }
  }

  async function act(id: string, action: "confirm" | "reject") {
    if (action === "reject" && !window.confirm("確定作廢這筆報名？（不會轉成正式）")) return;
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration("/api/admin/public-reg", { method: "POST", body: JSON.stringify({ action, id }) });
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setMsg(action === "confirm" ? "已確認並轉為正式報名。" : "已作廢。");
      await load();
    } catch { setErr("操作失敗"); } finally { setBusy(false); }
  }

  function summarize(p: any): string {
    const parts: string[] = [];
    const n = (arr: any[]) => (Array.isArray(arr) ? arr.length : 0);
    if (n(p?.ancestors)) parts.push(`祖先×${n(p.ancestors)}`);
    if (n(p?.souls)) parts.push(`正魂×${n(p.souls)}`);
    if (p?.creditor) parts.push("冤親");
    if (n(p?.unborn)) parts.push(`無緣/地基主×${n(p.unborn)}`);
    if (Number(p?.riceKg) > 0) parts.push(`白米${p.riceKg}斤`);
    if (Number(p?.sponsorQty) > 0) parts.push(`贊普×${p.sponsorQty}`);
    if (Number(p?.donationAmount) > 0) parts.push(`大額贊普$${p.donationAmount}`);
    return parts.join("、") || "（未選項目）";
  }

  function copyUrl() { if (publicUrl) { navigator.clipboard?.writeText(publicUrl); setMsg("已複製網址。"); } }

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 flex flex-col gap-6">
      <div>
        <h1 className="text-lg text-ink">信眾公開報名・後台</h1>
        <p className="mt-1 text-sm text-ink-soft">設定活動的線上報名表 → 產生網址＋QR 發給信眾 → 信眾填的進「待確認」，你核對後按確認即轉正式。</p>
      </div>

      <section className={card}>
        <h2 className="text-base font-medium text-ink">① 選活動、設定報名表</h2>
        <div className="mt-3 flex flex-col gap-3">
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">活動</span>
            <select value={templeEventId} onChange={(e) => setTempleEventId(e.target.value)} className={inputCls}>
              {activities.map((a) => <option key={a.templeEventId} value={a.templeEventId}>民國 {a.year} 年・{a.name}</option>)}
            </select>
          </label>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">網址代碼（slug，例：普渡115）</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="普渡115" className={inputCls} /></label>
          <div>
            <span className="text-xs text-ink-soft">要收哪些選填欄位</span>
            <div className="mt-1 flex gap-4 text-sm">
              <label className="flex items-center gap-1"><input type="checkbox" checked={fields.phone} onChange={(e) => setFields((f) => ({ ...f, phone: e.target.checked }))} />電話</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={fields.address} onChange={(e) => setFields((f) => ({ ...f, address: e.target.checked }))} />地址</label>
              <label className="flex items-center gap-1"><input type="checkbox" checked={fields.birthday} onChange={(e) => setFields((f) => ({ ...f, birthday: e.target.checked }))} />生日</label>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">牌位每份 $</span>
              <input value={prices.tablet} onChange={(e) => setPrices((p) => ({ ...p, tablet: e.target.value }))} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">白米每斤 $</span>
              <input value={prices.ricePerJin} onChange={(e) => setPrices((p) => ({ ...p, ricePerJin: e.target.value }))} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">贊普每份 $</span>
              <input value={prices.sponsorPerUnit} onChange={(e) => setPrices((p) => ({ ...p, sponsorPerUnit: e.target.value }))} inputMode="numeric" className={inputCls} /></label>
            <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">寶袋每份 $</span>
              <input value={prices.pocket} onChange={(e) => setPrices((p) => ({ ...p, pocket: e.target.value }))} inputMode="numeric" className={inputCls} /></label>
          </div>
          <label className="flex flex-col gap-1"><span className="text-xs text-ink-soft">抬頭說明（選填，顯示給信眾）</span>
            <input value={headerNote} onChange={(e) => setHeaderNote(e.target.value)} placeholder="例：報名後請到宮裡繳費" className={inputCls} /></label>
          <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={isOpen} onChange={(e) => setIsOpen(e.target.checked)} />開放線上報名（取消勾選＝暫停收件）</label>
          <div>
            <button type="button" disabled={busy} onClick={saveForm} style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }} className="rounded-full px-5 py-2 text-sm font-semibold">儲存並產生網址</button>
          </div>
        </div>
      </section>

      {form && (
        <section className={card}>
          <h2 className="text-base font-medium text-ink">② 報名網址（發給信眾）</h2>
          <div className="mt-3 flex flex-col sm:flex-row gap-4 items-start">
            <div>
              <div className="rounded-lg bg-cream-50 px-3 py-2 text-sm font-mono break-all">{publicUrl}</div>
              <div className="mt-2 flex gap-2">
                <button type="button" onClick={copyUrl} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink">複製網址</button>
                <a href={publicUrl} target="_blank" rel="noreferrer" className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink">開啟預覽 →</a>
              </div>
              <p className="mt-2 text-xs text-ink-faint">{form.isOpen ? "目前開放報名中。" : "⚠️ 目前已暫停收件（信眾打開會看到未開放）。"}</p>
            </div>
            <div ref={qrRef} className="rounded-lg bg-white p-2 border border-mist-200" aria-label="報名網址 QR code" />
          </div>
        </section>
      )}

      <section className={card}>
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium text-ink">③ 待確認清單</h2>
          <button type="button" onClick={() => void load()} className="rounded-full bg-mist-200 px-3 py-1 text-xs text-ink">重新整理</button>
        </div>
        {msg && <p className="mt-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="mt-2 text-sm text-blossom-500">⚠️ {err}</p>}
        <p className="mt-2 text-sm text-ink-soft">共 {rows.length} 筆待確認。核對手寫本沒問題後按「確認」＝已收到、直接轉成正式報名。</p>
        <div className="mt-3 flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.id} className="rounded-lg bg-cream-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <b className="text-ink">{r.payload?.registrant?.name ?? "（無姓名）"}</b>
                  <span className="text-ink-soft"> ｜ {summarize(r.payload)}</span>
                  {r.payload?.registrant?.phone && <span className="text-ink-faint"> ｜☎ {r.payload.registrant.phone}</span>}
                </div>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} onClick={() => act(r.id, "confirm")} style={{ backgroundColor: "#2f7d5b", color: "#fff" }} className="rounded-full px-4 py-1 text-xs font-semibold disabled:opacity-40">確認轉正式</button>
                  <button type="button" disabled={busy} onClick={() => act(r.id, "reject")} className="rounded-full bg-mist-200 px-3 py-1 text-xs text-ink disabled:opacity-40">作廢</button>
                </div>
              </div>
              {r.payload?.registrant?.address && <div className="mt-1 text-xs text-ink-faint">地址：{r.payload.registrant.address}</div>}
            </div>
          ))}
          {rows.length === 0 && <p className="text-sm text-ink-faint">目前沒有待確認的報名。</p>}
        </div>
      </section>
    </main>
  );
}
