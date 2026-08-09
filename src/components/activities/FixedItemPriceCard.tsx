"use client";

import { useEffect, useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import { inputClass, labelClass, primaryButtonClass, errorTextClass } from "@/components/household/formStyles";

/**
 * 贊普型報名項目（補庫／宮燈）的固定單價設定卡片——嵌在活動首頁（/activities/[id]）。
 * 單價存在項目本身（RegistrationItemType.defaultUnitPrice，見 fixedItemPrice.ts），不動資料庫。
 * 自行讀取目前單價（GET），儲存走 PATCH；修改只影響之後建立的報名。
 */
export default function FixedItemPriceCard(props: { itemKey: string; title: string; note?: string }) {
  return (
    <OperatorProvider>
      <Inner {...props} />
    </OperatorProvider>
  );
}

function Inner({ itemKey, title, note }: { itemKey: string; title: string; note?: string }) {
  const { operatorUser } = useOperator();
  const [value, setValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/registration-item-types/${itemKey}/fixed-price`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) { if (d?.ok && d.unitPrice != null) setValue(String(d.unitPrice)); setLoaded(true); } })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, [itemKey]);

  async function save() {
    setError(null);
    setSaved(false);
    const parsed = Number(value.trim());
    if (value.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      setError("請輸入 0 以上的單價數字");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/registration-item-types/${itemKey}/fixed-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, unitPrice: parsed }),
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
      <h2 className="text-sm text-ink">{title}</h2>
      <p className="mt-1 text-xs text-ink-faint">{note ?? "報名勾選此項目時，以此單價 × 份數計算應收。"}</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>單價（元）</span>
          <input type="number" min={0} step={1} value={value} onChange={(e) => { setValue(e.target.value); setSaved(false); }} className={`${inputClass} w-36`} disabled={!loaded} />
        </label>
        <button type="button" className={primaryButtonClass} onClick={() => void save()} disabled={saving || !loaded}>
          {saving ? "儲存中…" : "儲存"}
        </button>
        {saved && <span className="pb-2 text-xs text-sage-300">已儲存</span>}
      </div>
      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}
      <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        這是「目前單價」，每年設定一次即可。修改後只影響之後建立的報名；既有報名與已收款不受影響。
      </p>
    </section>
  );
}
