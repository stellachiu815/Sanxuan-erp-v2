"use client";

import { useEffect, useState } from "react";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import NewActivityRegistrationDialog from "@/components/devotee/NewActivityRegistrationDialog";

/**
 * V38「新增活動報名（找人／建人）」：
 *  先搜尋既有信眾→選他；查無此人→打姓名＋地址當場建新信眾（戶名「姓家」）→ 接同一個豐富版報名對話框。
 * 不重做報名邏輯，只在前面加「找人／建人」一步。
 */

type Hit = { memberId: string; name: string; householdId: string; householdName: string; address: string | null };

export default function NewRegistrationPage() {
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
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [searched, setSearched] = useState(false);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      const query = q.trim();
      if (!query) { setResults([]); setSearched(false); return; }
      try {
        const res = await fetchRegistration(`/api/quick-registration/devotees?q=${encodeURIComponent(query)}`);
        const d = await res.json();
        setResults(res.ok ? (d.results ?? []) : []);
        setSearched(true);
      } catch { setResults([]); setSearched(true); }
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  async function createNew() {
    if (!q.trim()) return;
    setBusy(true); setErr(null);
    try {
      const res = await fetchRegistration("/api/registrations/new-person", { method: "POST", body: JSON.stringify({ name: q.trim(), address: addr.trim() || null }) });
      const d = await res.json();
      if (!res.ok) { setErr(toFriendlyError(res.status, d?.error)); return; }
      setMemberId(d.memberId);
    } catch { setErr("建立新信眾失敗"); } finally { setBusy(false); }
  }

  const inputCls = "w-full rounded-lg border border-mist-200 px-3 py-2 text-sm";

  return (
    <main className="mx-auto max-w-xl px-6 py-8 flex flex-col gap-4">
      <div>
        <h1 className="text-lg text-ink">新增活動報名</h1>
        <p className="mt-1 text-sm text-ink-soft">先找人：搜尋既有信眾就選他；<b>查無此人就當場建新信眾</b>（打姓名＋地址）再報名，不用先去別的地方建。</p>
      </div>

      <section className="rounded-2xl bg-white/70 p-5 shadow-card">
        <label className="flex flex-col gap-1">
          <span className="text-xs text-ink-soft">信眾姓名</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="輸入姓名搜尋（例：王小明）" className={inputCls} autoFocus />
        </label>

        {results.length > 0 && (
          <div className="mt-3 flex flex-col gap-1">
            <p className="text-xs text-ink-soft">選一位既有信眾：</p>
            {results.map((h) => (
              <button key={h.memberId} type="button" onClick={() => setMemberId(h.memberId)} className="text-left text-sm rounded-lg bg-cream-50 px-3 py-2 hover:bg-cream-100">
                <b className="text-ink">{h.name}</b>
                <span className="text-ink-soft">｜{h.householdName}（{h.householdId}）</span>
                <span className="text-ink-faint">｜{h.address ?? "無地址"}</span>
              </button>
            ))}
          </div>
        )}

        {searched && results.length === 0 && q.trim() && (
          <div className="mt-3 rounded-lg bg-sage-50 p-3">
            <p className="text-sm text-ink">查無「{q.trim()}」→ 建立新信眾</p>
            <input value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="地址（選填，之後可補）" className={`mt-2 ${inputCls}`} />
            <button type="button" disabled={busy} onClick={createNew}
              style={{ backgroundColor: "#2f7d5b", color: "#fff", opacity: busy ? 0.5 : 1 }}
              className="mt-2 rounded-full px-5 py-2 text-sm font-semibold">
              {busy ? "建立中…" : `建立新信眾「${q.trim()}」並報名`}
            </button>
          </div>
        )}
        {err && <p className="mt-2 text-sm text-blossom-500">⚠️ {err}</p>}
      </section>

      {memberId && (
        <NewActivityRegistrationDialog
          memberId={memberId}
          onClose={() => { setMemberId(null); }}
        />
      )}
    </main>
  );
}
