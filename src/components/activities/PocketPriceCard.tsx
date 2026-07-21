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
 * V13.3B：活動的寶袋預設單價設定（第六階段）。
 *
 * ⚠️ 這**不是第二套活動設定頁**——它是一張卡片，嵌在既有的活動首頁
 * （/activities/[id]）裡，與其他活動設定並列。
 *
 * 三個必須守住的規則：
 *   1. 只影響**之後新增**的寶袋。既有 AdditionalPrintItem 的 unitPrice 是
 *      建立當下的快照，絕不回頭重算（畫面上明確寫給使用者看）。
 *   2. 活動未設定時顯示 fallback 300，並標示「使用系統預設」。
 *   3. 金額驗證：前端擋負數／空值／非數字，伺服器再驗一次（最終防線）。
 */

type Props = {
  templeEventId: string;
  year: number;
  /** 資料庫實際值。null 代表尚未設定（畫面顯示 fallback） */
  initialPocketUnitPrice: number | null;
  /** 已 fallback 的有效單價 */
  initialEffectivePrice: number;
};

export default function PocketPriceCard(props: Props) {
  // 這張卡片可能被掛在還沒有 OperatorProvider 的頁面上，自己包一層。
  return (
    <OperatorProvider>
      <PocketPriceCardInner {...props} />
    </OperatorProvider>
  );
}

function PocketPriceCardInner({
  templeEventId,
  year,
  initialPocketUnitPrice,
  initialEffectivePrice,
}: Props) {
  const { operatorUser } = useOperator();
  const [value, setValue] = useState(String(initialEffectivePrice));
  const [isFallback, setIsFallback] = useState(initialPocketUnitPrice === null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setSaved(false);

    // 前端驗證（伺服器仍會再驗一次）
    const trimmed = value.trim();
    if (trimmed === "") {
      setError("請輸入寶袋單價");
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      setError("寶袋單價必須是數字");
      return;
    }
    if (parsed < 0) {
      setError("寶袋單價不得小於 0");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/pocket-price`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operatorUserId: operatorUser?.id ?? null,
          pocketUnitPrice: parsed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        // 伺服器的明確錯誤原樣顯示（含 401／403 權限不足）
        setError(data.error ?? "儲存失敗，請稍後再試一次。");
        return;
      }
      setIsFallback(false);
      setSaved(true);
    } catch {
      setError("網路錯誤，請稍後再試一次。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-3xl bg-white/70 p-6 shadow-card">
      <h2 className="text-sm text-ink">寶袋預設單價</h2>
      <p className="mt-1 text-xs text-ink-faint">
        民國 {year} 年度普渡。新增寶袋時會自動帶入這個金額，單筆仍可個別調整。
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

      {isFallback && (
        <p className="mt-2 text-xs text-ink-faint">
          目前使用系統預設 300 元（這個活動尚未單獨設定過）。
        </p>
      )}

      {error && <p className={`mt-2 ${errorTextClass}`}>{error}</p>}

      <p className="mt-3 rounded-2xl bg-cream-100 px-4 py-3 text-xs leading-relaxed text-ink-soft">
        修改這個價格<span className="text-ink">只會影響之後新增的寶袋</span>，
        已經建立的寶袋金額不會被重新計算，也不會影響已完成的收款與收據。
      </p>
    </section>
  );
}
