"use client";

import { useCallback, useEffect, useState } from "react";
import { inputClass, labelClass, primaryButtonClass, errorTextClass } from "@/components/household/formStyles";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V15R5：年度燈活動設定——祭改／全家燈年度單價。
 *
 * 查看／修改／儲存皆透過 /api/temple-events/[id]/annual-lantern-prices（GET/PATCH），
 * 使用者不需自行呼叫 API。儲存後報名時自動以該年度單價計算應收：
 * 祭改→PurificationEntry、全家燈→RitualRegistrationItem（皆不重複應收）。
 */
export default function AnnualLanternPriceSettings({ templeEventId }: { templeEventId: string }) {
  const operatorUserId = useStoredOperatorUserId();
  const [purification, setPurification] = useState<string>("");
  const [family, setFamily] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = operatorUserId ? `?operatorUserId=${encodeURIComponent(operatorUserId)}` : "";
      const res = await fetch(`/api/temple-events/${templeEventId}/annual-lantern-prices${q}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "載入失敗");
        return;
      }
      setPurification(data.purificationUnitPrice != null ? String(data.purificationUnitPrice) : "");
      setFamily(data.familyLanternUnitPrice != null ? String(data.familyLanternUnitPrice) : "");
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }, [templeEventId, operatorUserId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const body: Record<string, unknown> = { operatorUserId };
      body.purificationUnitPrice = purification.trim() === "" ? null : Number(purification);
      body.familyLanternUnitPrice = family.trim() === "" ? null : Number(family);
      const res = await fetch(`/api/temple-events/${templeEventId}/annual-lantern-prices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? "儲存失敗");
        return;
      }
      setMessage("已儲存年度單價。報名時會自動以此單價計算應收。");
      await load();
    } catch {
      setError("網路錯誤，請稍後再試。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-2xl bg-white/70 p-6 shadow-soft">
      <h2 className="text-lg font-medium text-ink">年度燈單價設定</h2>
      <p className="mt-1 text-xs text-ink-faint">
        每年度設定一次；留空＝未設定（該項應收為 0）。祭改收款走小人頭祭改資料、全家燈走報名項目，皆不重複應收。
      </p>
      {loading ? (
        <p className="mt-4 text-sm text-ink-soft">載入中…</p>
      ) : (
        <div className="mt-4 flex flex-col gap-4 sm:flex-row">
          <div className="flex-1">
            <label className={labelClass}>祭改單價（元）</label>
            <input className={inputClass} type="number" inputMode="numeric" value={purification} onChange={(e) => setPurification(e.target.value)} placeholder="未設定" />
          </div>
          <div className="flex-1">
            <label className={labelClass}>全家燈單價（元／每戶）</label>
            <input className={inputClass} type="number" inputMode="numeric" value={family} onChange={(e) => setFamily(e.target.value)} placeholder="未設定" />
          </div>
          <div className="flex items-end">
            <button type="button" className={primaryButtonClass} onClick={save} disabled={saving}>
              {saving ? "儲存中…" : "儲存單價"}
            </button>
          </div>
        </div>
      )}
      {error && <p className={`${errorTextClass} mt-2`}>{error}</p>}
      {message && <p className="mt-2 text-sm text-sage-400">{message}</p>}
    </section>
  );
}
