"use client";

import { useEffect, useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * 活動年度設定編輯卡（受理日期／開放開關）——嵌在活動首頁（/activities/[id]），所有活動類型通用。
 * 建立活動後可隨時改;只改控管欄位,不動任何已建立的報名資料。自載入(GET)＋儲存(PATCH)。
 */
export default function ActivitySettingsCard({ templeEventId }: { templeEventId: string }) {
  return (
    <OperatorProvider>
      <Inner templeEventId={templeEventId} />
    </OperatorProvider>
  );
}

function Inner({ templeEventId }: { templeEventId: string }) {
  const { operatorUser } = useOperator();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [regOpen, setRegOpen] = useState(true);
  const [printOpen, setPrintOpen] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/temple-events/${templeEventId}/settings`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d?.ok) {
          setStart(d.registrationStartAt ?? "");
          setEnd(d.registrationEndAt ?? "");
          setRegOpen(!!d.isRegistrationOpen);
          setPrintOpen(!!d.isPrintOpen);
        }
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [templeEventId]);

  async function save() {
    setError(null);
    setSaved(false);
    setSaving(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/settings`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId: operatorUser?.id ?? null,
          registrationStartAt: start || null,
          registrationEndAt: end || null,
          isRegistrationOpen: regOpen,
          isPrintOpen: printOpen,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "儲存失敗，請稍後再試一次。"); return; }
      setSaved(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">活動設定（受理日期／開放）</h2>
      <p className="mt-1 text-xs text-ink-faint">建立後可隨時修改；只改控管開關與日期，<b>不影響任何已建立的報名</b>。</p>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>開始受理日期</span>
          <input type="date" value={start} onChange={(e) => { setStart(e.target.value); setSaved(false); }} className={inputClass} disabled={!loaded} />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelClass}>截止受理日期</span>
          <input type="date" value={end} onChange={(e) => { setEnd(e.target.value); setSaved(false); }} className={inputClass} disabled={!loaded} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={regOpen} onChange={(e) => { setRegOpen(e.target.checked); setSaved(false); }} disabled={!loaded} />開放報名
        </label>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input type="checkbox" checked={printOpen} onChange={(e) => { setPrintOpen(e.target.checked); setSaved(false); }} disabled={!loaded} />開放列印
        </label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" className={primaryButtonClass} onClick={() => void save()} disabled={saving || !loaded}>
          {saving ? "儲存中…" : "儲存設定"}
        </button>
        {saved && <span className="text-xs text-sage-300">已儲存</span>}
      </div>
      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
      <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        日期留空＝不用日期控管，由「開放報名」開關決定。年度燈日期填錯時，在這裡改即可，<b>不必取消重建</b>。
      </p>
    </section>
  );
}
