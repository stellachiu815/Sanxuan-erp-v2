"use client";

import { useCallback, useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";

/**
 * 名單型（補庫/宮燈）活動頁的「公開報名管理」——產生報名網址 + 待確認清單 + 一鍵建檔＋確認。
 * 全走既有 /api/admin/public-reg（save-form / confirm / reject / list），確認已於後端分流到 rosterRegister。
 */
type RegRow = { id: string; status: string; createdAt: string; payload: { kind?: string; people?: { name: string; phone?: string | null; address?: string | null; quantity?: number | null }[] } };

export default function RosterPublicRegManager({ templeEventId }: { templeEventId: string }) {
  return (
    <OperatorProvider>
      <Inner templeEventId={templeEventId} />
    </OperatorProvider>
  );
}

function Inner({ templeEventId }: { templeEventId: string }) {
  const [slug, setSlug] = useState("");
  const [form, setForm] = useState<{ slug: string; isOpen: boolean } | null>(null);
  const [rows, setRows] = useState<RegRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/admin/public-reg?templeEventId=${templeEventId}&status=PENDING`);
      const d = await res.json();
      if (res.ok) {
        setForm(d.form ? { slug: d.form.slug, isOpen: d.form.isOpen } : null);
        setRows(Array.isArray(d.rows) ? d.rows : []);
        if (d.form?.slug) setSlug((prev) => prev || d.form.slug);
      } else {
        setErr(toFriendlyError(res.status, d?.error));
      }
    } catch { /* 靜默：頁面其他區塊不受影響 */ }
  }, [templeEventId]);
  useEffect(() => { void load(); }, [load]);

  async function saveForm() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/public-reg`, {
        method: "POST",
        body: JSON.stringify({ action: "save-form", templeEventId, slug: slug.trim(), fields: ["phone", "address", "birthday"], isOpen: true }),
      });
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setMsg("已開放公開報名，可把下方網址給信眾。");
      await load();
    } catch { setErr("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }
  async function confirmOne(id: string) {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const res = await fetchRegistration(`/api/admin/public-reg`, { method: "POST", body: JSON.stringify({ action: "confirm", id }) });
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setMsg("已建檔＋確認成正式報名。");
      await load();
    } catch { setErr("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }
  async function rejectOne(id: string) {
    if (!window.confirm("確定作廢這筆公開報名嗎？（不會建立任何資料）")) return;
    setBusy(true); setErr(null);
    try { await fetchRegistration(`/api/admin/public-reg`, { method: "POST", body: JSON.stringify({ action: "reject", id }) }); await load(); }
    catch { setErr("連線問題，請稍後再試。"); } finally { setBusy(false); }
  }

  const publicUrl = form ? `${typeof window !== "undefined" ? window.location.origin : ""}/join/${encodeURIComponent(form.slug)}` : "";

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">公開報名（信眾自己上網填）</h2>
      <p className="mt-1 text-xs text-ink-faint">產生一個報名網址給信眾填；送出後進「待確認清單」，你核對後按「一鍵建檔＋確認」才會建成正式信眾與報名（不會馬上收款）。</p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-soft">網址代碼（可中文，例：補庫115）</span>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="補庫115" className="rounded-lg border border-cream-200 px-3 py-2 text-sm text-ink" />
        </label>
        <button type="button" onClick={() => void saveForm()} disabled={busy || !slug.trim()} className="rounded-full bg-sage-300 px-4 py-2 text-sm text-ink disabled:opacity-40">
          {form ? "更新／開放" : "開放公開報名"}
        </button>
      </div>
      {form && (
        <p className="mt-2 break-all text-sm text-ink">
          報名網址：<a href={publicUrl} target="_blank" rel="noreferrer" className="text-blossom-500 underline">{publicUrl}</a>
        </p>
      )}
      {msg && <p className="mt-2 text-xs text-sage-500">{msg}</p>}
      {err && <p className="mt-2 text-xs text-blossom-500">⚠️ {err}</p>}

      <div className="mt-4">
        <h3 className="text-sm font-medium text-ink">待確認清單（{rows.length}）</h3>
        {rows.length === 0 ? (
          <p className="mt-1 text-xs text-ink-faint">目前沒有待確認的公開報名。</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {rows.map((r) => {
              const people = r.payload?.kind === "ROSTER" ? (r.payload.people ?? []) : [];
              return (
                <li key={r.id} className="rounded-xl bg-cream-50 p-3">
                  <div className="text-sm text-ink">
                    {people.length > 0 ? people.map((p) => `${p.name}${(p.quantity ?? 1) > 1 ? `×${p.quantity}` : ""}`).join("、") : "（非名單型資料）"}
                  </div>
                  {people.length > 0 && (
                    <div className="mt-1 text-xs text-ink-faint">
                      {people.map((p) => [p.phone, p.address].filter(Boolean).join(" ")).filter(Boolean).join("｜")}
                    </div>
                  )}
                  <div className="mt-2 flex gap-2">
                    <button type="button" onClick={() => void confirmOne(r.id)} disabled={busy} className="rounded-full bg-blossom-200 px-3 py-1 text-xs text-ink disabled:opacity-40">一鍵建檔＋確認</button>
                    <button type="button" onClick={() => void rejectOne(r.id)} disabled={busy} className="rounded-full bg-cream-200 px-3 py-1 text-xs text-ink-soft">作廢</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
