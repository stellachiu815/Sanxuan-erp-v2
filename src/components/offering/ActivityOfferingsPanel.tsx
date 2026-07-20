"use client";

import { useState } from "react";
import Link from "next/link";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import {
  offeringPaymentStatusLabel,
  offeringClaimStatusLabel,
  activityOfferingStatusLabel,
} from "@/lib/labels";
import type { ActivityOfferingJSON, OfferingClaimJSON, OfferingTypeJSON, MemberSearchResult } from "./types";
import { useStoredOperatorUserId } from "@/lib/operatorClient";

/**
 * V10.1「供品認捐中心」核心畫面：需求「二、活動供品設定」＋「三～九」
 * 認捐資料的新增/查看/收款/取消/退款，全部整合在這一個活動供品管理面板。
 *
 * 花果供品（behaviorKind=FLORAL）不在這裡列出逐筆認捐，改連結到專屬的
 * 「花果供品年度名單」畫面（/offering-center/floral/[offeringId]），因為
 * 花果供品是 24 個固定日期名額，用日曆式的名單畫面比逐筆列表更直覺
 * （見 src/components/offering/FloralRosterScreen.tsx）。
 */
export default function ActivityOfferingsPanel({
  templeEventId,
  initialOfferings,
  allOfferingTypes,
}: {
  templeEventId: string;
  initialOfferings: ActivityOfferingJSON[];
  allOfferingTypes: OfferingTypeJSON[];
}) {

  const [offerings, setOfferings] = useState(initialOfferings);
  const [showAddOffering, setShowAddOffering] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/temple-events/${templeEventId}/offerings`);
    const data = await res.json();
    setOfferings(data.offerings ?? []);
  }

  const usedTypeIds = new Set(offerings.map((o) => o.offeringTypeId));
  const availableTypes = allOfferingTypes.filter((t) => t.isActive && !usedTypeIds.has(t.id));

  return (
    <div className="flex flex-col gap-4">
      {offerings.length === 0 && <p className="text-sm text-ink-faint">這個活動目前還沒有設定任何供品。</p>}

      {offerings.map((offering) => (
        <div key={offering.id} className="rounded-2xl bg-cream-100 p-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base text-ink">{offering.offeringType.name}</span>
                <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
                  {activityOfferingStatusLabel[offering.status] ?? offering.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-ink-soft">
                數量 {offering.quantity}
                {offering.price ? `／單價 ${Number(offering.price).toLocaleString("zh-Hant")} 元` : offering.useDefaultPrice ? "／使用預設價格" : "／未設定價格"}
              </p>
            </div>
            <div className="flex min-h-12 flex-wrap gap-2">
              {offering.offeringType.behaviorKind === "FLORAL" ? (
                <Link href={`/offering-center/floral/${offering.id}`} className={secondaryButtonClass}>
                  查看花果供品名單 →
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === offering.id ? null : offering.id)}
                  className={secondaryButtonClass}
                >
                  {expandedId === offering.id ? "收起認捐名單" : "查看認捐名單"}
                </button>
              )}
            </div>
          </div>

          {expandedId === offering.id && offering.offeringType.behaviorKind !== "FLORAL" && (
            <div className="mt-4 border-t border-cream-300 pt-4">
              <ClaimsPanel templeEventId={templeEventId} offering={offering} />
            </div>
          )}
        </div>
      ))}

      {showAddOffering ? (
        <AddOfferingForm
          templeEventId={templeEventId}
          availableTypes={availableTypes}
          onDone={async () => {
            setShowAddOffering(false);
            await refresh();
          }}
          onCancel={() => setShowAddOffering(false)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowAddOffering(true)}
          disabled={availableTypes.length === 0}
          className={`${primaryButtonClass} min-h-12 self-start`}
        >
          ＋加入供品
        </button>
      )}
      {availableTypes.length === 0 && !showAddOffering && (
        <p className="text-xs text-ink-faint">
          所有已啟用的供品種類都已經加入這個活動了。如果需要新的供品種類，請先到「供品種類設定」新增。
        </p>
      )}
    </div>
  );
}

function AddOfferingForm({
  templeEventId,
  availableTypes,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  availableTypes: OfferingTypeJSON[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const [offeringTypeId, setOfferingTypeId] = useState(availableTypes[0]?.id ?? "");
  const selectedType = availableTypes.find((t) => t.id === offeringTypeId);
  const [quantity, setQuantity] = useState(String(selectedType?.defaultQuantity ?? 1));
  const [useDefaultPrice, setUseDefaultPrice] = useState(true);
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!offeringTypeId) {
      setError("請選擇供品種類");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/offerings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          offeringTypeId,
          quantity: Number(quantity) || 1,
          useDefaultPrice,
          price: useDefaultPrice || price === "" ? null : Number(price),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "加入失敗");
        return;
      }
      onDone();
    } catch {
      setError("網路錯誤，請稍後再試一次");
    } finally {
      setSubmitting(false);
    }
  }

  if (availableTypes.length === 0) return null;

  return (
    <div className="rounded-2xl bg-mist-50 p-5">
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>供品種類</label>
          <select
            className={inputClass}
            value={offeringTypeId}
            onChange={(e) => {
              setOfferingTypeId(e.target.value);
              const t = availableTypes.find((x) => x.id === e.target.value);
              setQuantity(String(t?.defaultQuantity ?? 1));
            }}
          >
            {availableTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>當次數量</label>
          <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>價格</label>
          <label className="mb-1.5 flex items-center gap-2 text-xs text-ink-soft">
            <input type="checkbox" checked={useDefaultPrice} onChange={(e) => setUseDefaultPrice(e.target.checked)} />
            使用供品種類的預設價格
          </label>
          {!useDefaultPrice && (
            <input className={inputClass} type="number" min={0} value={price} onChange={(e) => setPrice(e.target.value)} placeholder="當次價格" />
          )}
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          {submitting ? "加入中…" : "加入這個供品"}
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}

function ClaimsPanel({ templeEventId, offering }: { templeEventId: string; offering: ActivityOfferingJSON }) {
  const [claims, setClaims] = useState<OfferingClaimJSON[] | null>(null);
  const [showAddClaim, setShowAddClaim] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/temple-events/${templeEventId}/offering-claims?activityOfferingId=${offering.id}`);
    const data = await res.json();
    setClaims(data.claims ?? []);
    setLoading(false);
  }

  if (claims === null && !loading) {
    load();
  }

  const activeClaims = (claims ?? []).filter((c) => c.status === "ACTIVE" || c.status === "REFUND_PENDING");
  const claimedQuantity = activeClaims.reduce((s, c) => s + c.quantity, 0);
  const remaining = Math.max(0, offering.quantity - claimedQuantity);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">
        應有 {offering.quantity}／已認捐 {claimedQuantity}／尚缺 {remaining}
      </p>

      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      {(claims ?? []).map((claim) => (
        <ClaimRow key={claim.id} claim={claim} onChanged={load} />
      ))}

      {showAddClaim ? (
        <AddClaimForm
          templeEventId={templeEventId}
          activityOfferingId={offering.id}
          onDone={async () => {
            setShowAddClaim(false);
            await load();
          }}
          onCancel={() => setShowAddClaim(false)}
        />
      ) : (
        <button type="button" onClick={() => setShowAddClaim(true)} className={`${primaryButtonClass} min-h-12 self-start`}>
          ＋新增認捐
        </button>
      )}
    </div>
  );
}

function AddClaimForm({
  templeEventId,
  activityOfferingId,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  activityOfferingId: string;
  onDone: () => void;
  onCancel: () => void;
}) {
  // V12.2 指令「五」：GET /api/search 這次補上了信眾 view 權限檢查，這裡
  // 沿用**同一個**既有身分來源把 operatorUserId 帶上（見
  // src/lib/operatorClient.tsx 的說明），不是另一套登入或角色機制。
  const operatorUserId = useStoredOperatorUserId();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}${operatorUserId ? `&operatorUserId=${encodeURIComponent(operatorUserId)}` : ""}`);
    const data = await res.json();
    setResults((data.results ?? []).filter((r: MemberSearchResult) => r.memberId));
  }

  async function handleSubmit() {
    if (!selected?.memberId) {
      setError("請先從信眾中心搜尋並選取認捐人");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/offering-claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityOfferingId,
          sponsorMemberId: selected.memberId,
          quantity: Number(quantity) || 1,
          unitPrice: unitPrice === "" ? undefined : Number(unitPrice),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
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
    <div className="rounded-2xl bg-sage-50 p-5">
      {error && <p className={errorTextClass}>{error}</p>}
      <label className={labelClass}>認捐人（請先搜尋信眾中心，查無資料請先到家戶資料新增信眾）</label>
      <input className={inputClass} value={query} onChange={(e) => search(e.target.value)} placeholder="輸入姓名搜尋" />
      {results.length > 0 && !selected && (
        <div className="mt-2 flex flex-col gap-1 rounded-xl bg-white p-2">
          {results.map((r) => (
            <button
              key={`${r.householdId}-${r.memberId}`}
              type="button"
              className="min-h-12 rounded-lg px-3 text-left text-sm hover:bg-cream-100"
              onClick={() => {
                setSelected(r);
                setQuery(r.name);
                setResults([]);
              }}
            >
              {r.name}（{r.householdId}）
            </button>
          ))}
        </div>
      )}
      {selected && <p className="mt-2 text-sm text-ink">已選擇：{selected.name}（{selected.householdId}）</p>}

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>數量</label>
          <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>單價（留空使用活動預設價格）</label>
          <input className={inputClass} type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          {submitting ? "新增中…" : "確認新增認捐"}
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}

function ClaimRow({ claim, onChanged }: { claim: OfferingClaimJSON; onChanged: () => void }) {
  const [showPayment, setShowPayment] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function recordPayment() {
    if (!Number(amount) || Number(amount) <= 0) {
      setError("請輸入正確的收款金額");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offering-claims/${claim.id}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(amount), paidOn: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "收款失敗");
        return;
      }
      setShowPayment(false);
      setAmount("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancelClaim() {
    setBusy(true);
    try {
      await fetch(`/api/offering-claims/${claim.id}/cancel`, { method: "POST" });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl bg-white/80 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-ink">{claim.sponsorNameSnapshot}</span>
        <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">
          {offeringClaimStatusLabel[claim.status] ?? claim.status}
        </span>
        <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">
          {offeringPaymentStatusLabel[claim.paymentStatus] ?? claim.paymentStatus}
        </span>
        <span className="ml-auto text-xs text-ink-faint">
          應收 {Number(claim.amountDue).toLocaleString("zh-Hant")}／已收 {Number(claim.amountPaid).toLocaleString("zh-Hant")}
        </span>
      </div>
      {claim.status === "ACTIVE" && (
        <div className="mt-2 flex min-h-12 flex-wrap items-center gap-2">
          <button type="button" onClick={() => setShowPayment(!showPayment)} className={secondaryButtonClass}>
            登錄收款
          </button>
          <button type="button" onClick={cancelClaim} disabled={busy} className={secondaryButtonClass}>
            取消
          </button>
        </div>
      )}
      {showPayment && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {error && <p className={errorTextClass}>{error}</p>}
          <input className={`${inputClass} max-w-[10rem]`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="收款金額" />
          <button type="button" onClick={recordPayment} disabled={busy} className={`${primaryButtonClass} min-h-12`}>
            確認收款
          </button>
        </div>
      )}
    </div>
  );
}
