"use client";

import { useState } from "react";
import { useOperator, OperatorProvider } from "@/lib/operatorClient";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";

/**
 * V14.2：中元普渡「四類牌位」年度單價設定卡片。
 *
 * ⚠️ 與寶袋／贊普單價卡片並列，嵌在既有活動首頁（/activities/[id]），只在
 * UNIVERSAL_SALVATION 活動顯示，不改既有版型。四類：超拔祖先／乙位正魂／
 * 累世冤親債主／無緣子女；由宮方每年設定一次。未設定＝建立報名該項應收 0
 * （不寫死金額）。修改只影響之後新增或重算的 DRAFT 未收款項目。
 */

type Field = "ancestorUnitPrice" | "zhenghunUnitPrice" | "yuanqinUnitPrice" | "wuyuanUnitPrice";

const FIELDS: { key: Field; label: string }[] = [
  { key: "ancestorUnitPrice", label: "超拔祖先" },
  { key: "zhenghunUnitPrice", label: "乙位正魂" },
  { key: "yuanqinUnitPrice", label: "累世冤親債主" },
  { key: "wuyuanUnitPrice", label: "無緣子女" },
];

export type TabletPriceInitial = Record<Field, number | null>;

type Props = {
  templeEventId: string;
  year: number;
  initialPrices: TabletPriceInitial;
};

export default function TabletPriceCard(props: Props) {
  return (
    <OperatorProvider>
      <TabletPriceCardInner {...props} />
    </OperatorProvider>
  );
}

function TabletPriceCardInner({ templeEventId, year, initialPrices }: Props) {
  const { operatorUser } = useOperator();
  const [values, setValues] = useState<Record<Field, string>>({
    ancestorUnitPrice: initialPrices.ancestorUnitPrice === null ? "" : String(initialPrices.ancestorUnitPrice),
    zhenghunUnitPrice: initialPrices.zhenghunUnitPrice === null ? "" : String(initialPrices.zhenghunUnitPrice),
    yuanqinUnitPrice: initialPrices.yuanqinUnitPrice === null ? "" : String(initialPrices.yuanqinUnitPrice),
    wuyuanUnitPrice: initialPrices.wuyuanUnitPrice === null ? "" : String(initialPrices.wuyuanUnitPrice),
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyUnset = FIELDS.some((f) => values[f.key].trim() === "");

  function setField(key: Field, v: string) {
    setValues((prev) => ({ ...prev, [key]: v }));
    setSaved(false);
  }

  async function save() {
    setError(null);
    setSaved(false);

    // 組 payload：空字串＝清除（null）；有值需為 >=0 數字。
    const payload: Record<string, number | null> = {};
    for (const f of FIELDS) {
      const trimmed = values[f.key].trim();
      if (trimmed === "") {
        payload[f.key] = null;
        continue;
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed)) {
        setError(`${f.label}單價必須是數字`);
        return;
      }
      if (parsed < 0) {
        setError(`${f.label}單價不得小於 0`);
        return;
      }
      payload[f.key] = parsed;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/tablet-prices`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ operatorUserId: operatorUser?.id ?? null, ...payload }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      setSaved(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">普渡牌位單價</h2>
      <p className="mt-1 text-xs text-ink-faint">
        民國 {year} 年度普渡。建立報名時，各項以此單價 × 數量計算應收。
      </p>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <label key={f.key} className="flex flex-col gap-1">
            <span className={labelClass}>{f.label}（元）</span>
            <input
              type="number"
              min={0}
              step={1}
              value={values[f.key]}
              onChange={(e) => setField(f.key, e.target.value)}
              className={`${inputClass} w-36`}
            />
          </label>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        {saved && <span className="text-xs text-sage-300">已儲存</span>}
      </div>

      {anyUnset && (
        <p className="mt-2 text-xs text-blossom-500">
          有項目尚未設定單價——在設定之前，勾選該項的報名應收會是 0。
        </p>
      )}

      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}

      <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        四類牌位沒有系統預設價，需由宮方每年設定一次。修改只影響之後新增或重新計算的
        草稿報名；已確認、已收款的舊資料不受影響。
      </p>
    </section>
  );
}
