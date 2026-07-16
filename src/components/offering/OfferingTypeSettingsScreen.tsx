"use client";

import { useState } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import {
  offeringBehaviorKindLabel,
  offeringUnitOptions,
  offeringClaimModeLabel,
} from "@/lib/labels";
import type { OfferingTypeJSON } from "./types";

/**
 * V10.1「供品認捐中心」需求「一、供品種類管理」＋「九、供品認捐中心畫面」
 * 選單第 9 項「供品種類設定」。管理者可自行新增、修改、停用及調整排序，
 * 所有設定都是這裡的表單欄位，不是寫死在程式碼裡（需求「一」最後一句）。
 */
export default function OfferingTypeSettingsScreen({ initialTypes }: { initialTypes: OfferingTypeJSON[] }) {
  const [types, setTypes] = useState(initialTypes);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch("/api/offering-types");
    const data = await res.json();
    setTypes(data.types ?? []);
  }

  async function toggleActive(id: string, isActive: boolean) {
    setError(null);
    const res = await fetch(`/api/offering-types/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "更新失敗");
      return;
    }
    await refresh();
  }

  async function move(id: string, direction: -1 | 1) {
    const idx = types.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= types.length) return;
    const reordered = [...types];
    [reordered[idx], reordered[swapWith]] = [reordered[swapWith], reordered[idx]];
    setTypes(reordered);
    await fetch("/api/offering-types/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderedIds: reordered.map((t) => t.id) }),
    });
  }

  return (
    <div className="flex flex-col gap-6">
      {error && <p className={errorTextClass}>{error}</p>}

      <div className="flex flex-col gap-3">
        {types.map((t, idx) => (
          <div key={t.id} className="rounded-2xl bg-cream-100 px-5 py-4">
            {editingId === t.id ? (
              <OfferingTypeForm
                initial={t}
                onDone={async () => {
                  setEditingId(null);
                  await refresh();
                }}
                onCancel={() => setEditingId(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-base text-ink">{t.name}</span>
                    <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                      {offeringBehaviorKindLabel[t.behaviorKind] ?? t.behaviorKind}
                    </span>
                    {!t.isActive && (
                      <span className="rounded-full bg-mist-200 px-2 py-0.5 text-xs text-ink-soft">已停用</span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    預設 {t.defaultQuantity} {offeringUnitOptions.find((u) => u.value === t.unit)?.label ?? t.unit}
                    {t.defaultPrice ? `／預設 ${Number(t.defaultPrice).toLocaleString("zh-Hant")} 元` : "／未設定預設價格"}
                    ／{t.isChargeable ? "收費" : "免收"}
                    ／{offeringClaimModeLabel[t.claimMode]}
                  </p>
                </div>
                <div className="flex min-h-12 flex-wrap items-center gap-2">
                  <button type="button" onClick={() => move(t.id, -1)} disabled={idx === 0} className={secondaryButtonClass}>
                    ↑
                  </button>
                  <button
                    type="button"
                    onClick={() => move(t.id, 1)}
                    disabled={idx === types.length - 1}
                    className={secondaryButtonClass}
                  >
                    ↓
                  </button>
                  <button type="button" onClick={() => setEditingId(t.id)} className={secondaryButtonClass}>
                    修改
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleActive(t.id, !t.isActive)}
                    className={secondaryButtonClass}
                  >
                    {t.isActive ? "停用" : "啟用"}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {showAddForm ? (
        <div className="rounded-2xl bg-mist-50 px-5 py-4">
          <OfferingTypeForm
            onDone={async () => {
              setShowAddForm(false);
              await refresh();
            }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      ) : (
        <button type="button" onClick={() => setShowAddForm(true)} className={`${primaryButtonClass} min-h-12 self-start`}>
          ＋新增供品種類
        </button>
      )}
    </div>
  );
}

function OfferingTypeForm({
  initial,
  onDone,
  onCancel,
}: {
  initial?: OfferingTypeJSON;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState(initial?.category ?? "");
  const [behaviorKind, setBehaviorKind] = useState(initial?.behaviorKind ?? "GENERIC");
  const [unit, setUnit] = useState(initial?.unit ?? "OTHER");
  const [isChargeable, setIsChargeable] = useState(initial?.isChargeable ?? true);
  const [hasLimitedQuantity, setHasLimitedQuantity] = useState(initial?.hasLimitedQuantity ?? true);
  const [defaultQuantity, setDefaultQuantity] = useState(String(initial?.defaultQuantity ?? 1));
  const [defaultPrice, setDefaultPrice] = useState(initial?.defaultPrice ?? "");
  const [allowPriceOverride, setAllowPriceOverride] = useState(initial?.allowPriceOverride ?? true);
  const [allowDuplicateClaim, setAllowDuplicateClaim] = useState(initial?.allowDuplicateClaim ?? false);
  const [claimMode, setClaimMode] = useState(initial?.claimMode ?? "INDIVIDUAL");
  const [note, setNote] = useState(initial?.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("請輸入供品名稱");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const url = initial ? `/api/offering-types/${initial.id}` : "/api/offering-types";
      const res = await fetch(url, {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          category: category || null,
          behaviorKind,
          unit,
          isChargeable,
          hasLimitedQuantity,
          defaultQuantity: Number(defaultQuantity) || 1,
          defaultPrice: defaultPrice === "" ? null : Number(defaultPrice),
          allowPriceOverride,
          allowDuplicateClaim,
          claimMode,
          note: note || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "儲存失敗");
        return;
      }
      onDone();
    } catch {
      setError("網路錯誤，請稍後再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>供品名稱</label>
          <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>供品類別</label>
          <input className={inputClass} value={category} onChange={(e) => setCategory(e.target.value)} placeholder="例如：壽龜／麵塔／花果／其他供品" />
        </div>
        <div>
          <label className={labelClass}>系統行為分類</label>
          <select className={inputClass} value={behaviorKind} onChange={(e) => setBehaviorKind(e.target.value as typeof behaviorKind)}>
            {Object.entries(offeringBehaviorKindLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>單位</label>
          <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value as typeof unit)}>
            {offeringUnitOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>預設數量</label>
          <input className={inputClass} type="number" min={1} value={defaultQuantity} onChange={(e) => setDefaultQuantity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>預設價格（留空代表未設定）</label>
          <input className={inputClass} type="number" min={0} value={defaultPrice} onChange={(e) => setDefaultPrice(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>認捐模式</label>
          <select className={inputClass} value={claimMode} onChange={(e) => setClaimMode(e.target.value as typeof claimMode)}>
            {Object.entries(offeringClaimModeLabel).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>備註</label>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4 text-sm text-ink">
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={isChargeable} onChange={(e) => setIsChargeable(e.target.checked)} />
          是否收費
        </label>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={hasLimitedQuantity} onChange={(e) => setHasLimitedQuantity(e.target.checked)} />
          是否有限量
        </label>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={allowPriceOverride} onChange={(e) => setAllowPriceOverride(e.target.checked)} />
          允許單筆修改價格
        </label>
        <label className="flex min-h-12 items-center gap-2">
          <input type="checkbox" checked={allowDuplicateClaim} onChange={(e) => setAllowDuplicateClaim(e.target.checked)} />
          允許同一信眾重複認捐
        </label>
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          {submitting ? "儲存中…" : "儲存"}
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}
