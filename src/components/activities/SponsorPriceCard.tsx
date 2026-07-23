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
 * V14.1：中元普渡活動的年度**贊普單價**設定。
 *
 * ⚠️ 這不是第二套活動設定頁——是嵌在既有活動首頁（/activities/[id]）的一張卡片，
 * 與寶袋單價卡片並列，只在 UNIVERSAL_SALVATION 活動顯示。
 *
 * 與寶袋單價不同：**沒有系統預設 fallback**。未設定就是「尚未設定」，
 * 建立普渡報名勾選贊普時會保留數量但擋住確認、顯示「尚未設定贊普單價」。
 */

type Props = {
  templeEventId: string;
  year: number;
  /** 資料庫實際值。null 代表尚未設定。 */
  initialSponsorUnitPrice: number | null;
};

export default function SponsorPriceCard(props: Props) {
  return (
    <OperatorProvider>
      <SponsorPriceCardInner {...props} />
    </OperatorProvider>
  );
}

function SponsorPriceCardInner({ templeEventId, year, initialSponsorUnitPrice }: Props) {
  const { operatorUser } = useOperator();
  const [value, setValue] = useState(initialSponsorUnitPrice === null ? "" : String(initialSponsorUnitPrice));
  const [isSet, setIsSet] = useState(initialSponsorUnitPrice !== null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaved(false);

    const trimmed = value.trim();
    if (trimmed === "") {
      setError("請輸入贊普單價");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setError("贊普單價必須是數字");
      return;
    }
    if (parsed < 0) {
      setError("贊普單價不得小於 0");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/sponsor-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId: operatorUser?.id ?? null,
          sponsorUnitPrice: parsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      setIsSet(true);
      setSaved(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">贊普單價</h2>
      <p className="mt-1 text-xs text-ink-faint">
        民國 {year} 年度普渡。建立報名勾選贊普時，會以此單價 × 贊普數量計算應收。
      </p>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className={labelClass}>單價（元）</span>
          <input
            type="number"
            min={0}
            step={1}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setSaved(false);
            }}
            className={`${inputClass} w-36`}
          />
        </label>
        <button
          type="button"
          className={primaryButtonClass}
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? "儲存中…" : "儲存"}
        </button>
        {saved && <span className="pb-2 text-xs text-sage-300">已儲存</span>}
      </div>

      {!isSet && (
        <p className="mt-2 text-xs text-blossom-500">
          尚未設定贊普單價——在設定之前，勾選贊普的報名會保留數量但無法確認。
        </p>
      )}

      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}

      <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        贊普沒有系統預設價，需由宮方每年設定一次。修改後只影響之後建立的贊普報名金額；
        已完成的收款與收據不受影響。
      </p>
    </section>
  );
}
