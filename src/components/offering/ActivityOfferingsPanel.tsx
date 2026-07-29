"use client";

import { useEffect, useState } from "react";
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
  activityOfferingStatusOptions,
  offeringUnitLabel,
} from "@/lib/labels";
import type { ActivityOfferingJSON, OfferingClaimJSON, OfferingTypeJSON, MemberSearchResult } from "./types";
import { useStoredOperatorUserId } from "@/lib/operatorClient";
import { getOfferingTemplate } from "@/lib/offeringRules";

/**
 * V10.1「供品認捐中心」＋V26.2「供品管理」畫面。
 *
 * 每一項供品是一張獨立卡片，分兩層呈現（需求 V26.2「三、六」）：
 *   1. 摘要層：名稱／單位／需求數量／本次單價（是否使用預設）／已認捐／剩餘／
 *      應收・已收・未收總額／認捐狀態／開放・截止狀態。
 *   2. 展開層：編輯設定（活動層價格/日期/狀態）與認捐管理（新增認捐、認捐
 *      名單、修改、收款、補收款、取消、退款/沖銷），分開的區塊、不擠在一起。
 *
 * 全部沿用既有 OfferingType／ActivityOffering／OfferingClaim／OfferingPayment
 * 與既有 API，不建立第二套系統。花果供品（FLORAL）逐日名額仍走既有專屬名單
 * 畫面（/offering-center/floral/[offeringId]），但活動層價格一樣用「編輯設定」。
 */

function toNum(v: string | null): number | null {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 本次活動有效單價：使用預設單價時取供品種類預設價，否則取本次活動自訂價。 */
function effectiveUnitPrice(o: ActivityOfferingJSON): number | null {
  return o.useDefaultPrice ? toNum(o.offeringType.defaultPrice) : toNum(o.price);
}

function fmtMoney(v: number | string | null): string {
  const n = typeof v === "string" ? Number(v) : v;
  if (n === null || n === undefined || !Number.isFinite(n)) return "0";
  return n.toLocaleString("zh-Hant");
}

function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : "";
}

const CLAIM_ACTIVE_STATUSES = new Set(["ACTIVE", "REFUND_PENDING"]);

// ── V26.3 供品認捐取消 UX：名單篩選（只調整顯示/查詢，不刪任何資料）──
type ClaimFilter = "ALL" | "ACTIVE" | "UNPAID" | "PAID" | "CANCELLED";

/** 篩選按鈕（順序＝畫面呈現順序）；預設「進行中」。 */
const CLAIM_FILTERS: { value: ClaimFilter; label: string }[] = [
  { value: "ALL", label: "全部" },
  { value: "ACTIVE", label: "進行中" },
  { value: "UNPAID", label: "未收款" },
  { value: "PAID", label: "已收款" },
  { value: "CANCELLED", label: "已取消" },
];

/**
 * 依篩選判斷某筆認捐是否顯示。已取消/退款相關（CANCELLED／REFUND_PENDING／
 * REFUNDED）一律歸在「已取消」，預設「進行中」不顯示——但認捐資料本身永遠保留，
 * 只是不列在預設名單（需求一、二、四）。
 */
function matchesClaimFilter(
  claim: { status: string; paymentStatus: string },
  filter: ClaimFilter
): boolean {
  switch (filter) {
    case "ALL":
      return true;
    case "ACTIVE":
      return claim.status === "ACTIVE";
    case "UNPAID":
      return claim.status === "ACTIVE" && (claim.paymentStatus === "UNPAID" || claim.paymentStatus === "PARTIAL");
    case "PAID":
      return claim.status === "ACTIVE" && (claim.paymentStatus === "PAID" || claim.paymentStatus === "WAIVED");
    case "CANCELLED":
      return claim.status === "CANCELLED" || claim.status === "REFUND_PENDING" || claim.status === "REFUNDED";
  }
}

export default function ActivityOfferingsPanel({
  templeEventId,
  activityType,
  initialOfferings,
  allOfferingTypes,
}: {
  templeEventId: string;
  activityType: string;
  initialOfferings: ActivityOfferingJSON[];
  allOfferingTypes: OfferingTypeJSON[];
}) {
  const [offerings, setOfferings] = useState(initialOfferings);
  const [showAddOffering, setShowAddOffering] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [seedMessage, setSeedMessage] = useState<string | null>(null);

  async function refresh() {
    const res = await fetch(`/api/temple-events/${templeEventId}/offerings`);
    const data = await res.json();
    setOfferings(data.offerings ?? []);
  }

  const usedTypeIds = new Set(offerings.map((o) => o.offeringTypeId));
  const availableTypes = allOfferingTypes.filter((t) => t.isActive && !usedTypeIds.has(t.id));

  // V26.1「供品活動模板」：這個活動類型應有、但目前還缺少的預設供品。
  const templateNames = getOfferingTemplate(activityType).map((e) => e.offeringName);
  const existingNames = new Set(offerings.map((o) => o.offeringType.name));
  const missingDefaults = templateNames.filter((n) => !existingNames.has(n));

  async function seedDefaults() {
    setSeeding(true);
    setSeedMessage(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/offerings/seed-defaults`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setSeedMessage(data.error ?? "建立預設供品失敗");
        return;
      }
      await refresh();
      const parts: string[] = [];
      if (data.createdCount > 0) parts.push(`已建立 ${data.createdCount} 項預設供品`);
      if (data.skippedCount > 0) parts.push(`略過 ${data.skippedCount} 項已存在`);
      if (Array.isArray(data.missingOfferingNames) && data.missingOfferingNames.length > 0) {
        parts.push(`找不到供品種類：${data.missingOfferingNames.join("、")}（請先到供品種類設定新增）`);
      }
      setSeedMessage(parts.length > 0 ? parts.join("；") : "沒有需要建立的預設供品");
    } catch {
      setSeedMessage("網路錯誤，請稍後再試一次");
    } finally {
      setSeeding(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {templateNames.length > 0 && missingDefaults.length > 0 && (
        <div className="rounded-2xl bg-mist-50 p-4">
          <p className="text-sm text-ink-soft">
            這個活動可一鍵建立預設供品（{missingDefaults.join("、")}），不需要逐項手動新增。
          </p>
          <button
            type="button"
            onClick={seedDefaults}
            disabled={seeding}
            className={`${primaryButtonClass} mt-3 min-h-12 self-start`}
          >
            {seeding ? "建立中…" : "建立預設供品"}
          </button>
        </div>
      )}
      {seedMessage && <p className="text-sm text-ink-soft">{seedMessage}</p>}

      {offerings.length === 0 && <p className="text-sm text-ink-faint">這個活動目前還沒有設定任何供品。</p>}

      {offerings.map((offering) => (
        <OfferingCard key={offering.id} templeEventId={templeEventId} offering={offering} onOfferingChanged={refresh} />
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

// ============================================================
// 供品卡片（摘要層 + 展開的設定 / 認捐管理）
// ============================================================

function OfferingCard({
  templeEventId,
  offering,
  onOfferingChanged,
}: {
  templeEventId: string;
  offering: ActivityOfferingJSON;
  onOfferingChanged: () => Promise<void> | void;
}) {
  const isFloral = offering.offeringType.behaviorKind === "FLORAL";
  const [claims, setClaims] = useState<OfferingClaimJSON[] | null>(null);
  const [panel, setPanel] = useState<"none" | "edit" | "add" | "list">("none");
  const [claimFilter, setClaimFilter] = useState<ClaimFilter>("ACTIVE"); // 預設：進行中

  async function loadClaims() {
    if (isFloral) return;
    const res = await fetch(`/api/temple-events/${templeEventId}/offering-claims?activityOfferingId=${offering.id}`);
    const data = await res.json();
    setClaims(data.claims ?? []);
  }

  useEffect(() => {
    if (!isFloral) loadClaims();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offering.id]);

  const activeClaims = (claims ?? []).filter((c) => CLAIM_ACTIVE_STATUSES.has(c.status));
  const claimedQty = activeClaims.reduce((s, c) => s + c.quantity, 0);
  const remaining =
    offering.claimMode === "GROUPED"
      ? Math.max(0, 1 - (activeClaims.length > 0 ? 1 : 0))
      : Math.max(0, offering.quantity - claimedQty);
  const totalDue = activeClaims.reduce((s, c) => s + Number(c.amountDue), 0);
  const totalPaid = activeClaims.reduce((s, c) => s + Number(c.amountPaid), 0);
  const totalUnpaid = activeClaims.reduce((s, c) => s + Number(c.amountUnpaid), 0);

  // V26.3：依目前篩選決定名單顯示哪些認捐（不影響上方數量統計）。
  const displayedClaims = (claims ?? []).filter((c) => matchesClaimFilter(c, claimFilter));

  const unit = offeringUnitLabel[offering.offeringType.unit] ?? "";
  const effPrice = effectiveUnitPrice(offering);
  const priceText = effPrice === null ? "未設定價格" : `${fmtMoney(effPrice)} 元`;
  const priceSourceText = offering.useDefaultPrice ? "使用預設單價" : "本次自訂單價";

  const dateText =
    offering.claimStartDate || offering.claimEndDate
      ? `開放 ${toDateInput(offering.claimStartDate) || "—"} ～ ${toDateInput(offering.claimEndDate) || "—"}`
      : "未設定開放/截止日期";

  async function afterClaimChange() {
    await loadClaims();
    await onOfferingChanged();
  }

  return (
    <div className="rounded-2xl bg-cream-100 p-5">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base text-ink">{offering.offeringType.name}</span>
            <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-ink-soft">
              {activityOfferingStatusLabel[offering.status] ?? offering.status}
            </span>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-ink-soft sm:grid-cols-3">
            <span>需求數量：{offering.quantity} {unit}</span>
            <span>本次單價：{priceText}</span>
            <span>{priceSourceText}</span>
            {!isFloral && <span>已認捐：{claims === null ? "…" : `${claimedQty} ${unit}`}</span>}
            {!isFloral && <span>剩餘：{claims === null ? "…" : `${remaining} ${unit}`}</span>}
            <span className="col-span-2 sm:col-span-3 text-xs text-ink-faint">{dateText}</span>
          </div>

          {!isFloral && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-ink-soft">應收 {claims === null ? "…" : fmtMoney(totalDue)}</span>
              <span className="text-sage-700">已收 {claims === null ? "…" : fmtMoney(totalPaid)}</span>
              <span className="text-ink">未收 {claims === null ? "…" : fmtMoney(totalUnpaid)}</span>
            </div>
          )}
        </div>
      </div>

      {/* 操作列：設定 / 認捐管理分層 */}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setPanel(panel === "edit" ? "none" : "edit")}
          className={secondaryButtonClass}
        >
          {panel === "edit" ? "收起設定" : "編輯設定"}
        </button>
        {isFloral ? (
          <Link href={`/offering-center/floral/${offering.id}`} className={secondaryButtonClass}>
            查看花果供品名單 →
          </Link>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setPanel(panel === "add" ? "none" : "add")}
              className={secondaryButtonClass}
            >
              {panel === "add" ? "收起新增認捐" : "＋新增認捐"}
            </button>
            <button
              type="button"
              onClick={() => setPanel(panel === "list" ? "none" : "list")}
              className={secondaryButtonClass}
            >
              {panel === "list" ? "收起認捐名單" : "查看認捐名單"}
            </button>
          </>
        )}
      </div>

      {panel === "edit" && (
        <div className="mt-4 border-t border-cream-300 pt-4">
          <EditOfferingForm
            templeEventId={templeEventId}
            offering={offering}
            onDone={async () => {
              setPanel("none");
              await onOfferingChanged();
            }}
            onCancel={() => setPanel("none")}
          />
        </div>
      )}

      {panel === "add" && !isFloral && (
        <div className="mt-4 border-t border-cream-300 pt-4">
          <AddClaimForm
            templeEventId={templeEventId}
            offering={offering}
            onDone={async () => {
              setPanel("list");
              await afterClaimChange();
            }}
            onCancel={() => setPanel("none")}
          />
        </div>
      )}

      {panel === "list" && !isFloral && (
        <div className="mt-4 border-t border-cream-300 pt-4">
          <p className="mb-3 text-sm text-ink-soft">
            應有 {offering.quantity}／已認捐 {claimedQty}／尚缺 {remaining}
          </p>

          {/* V26.3：名單篩選（預設「進行中」，切到「已取消」才看到取消紀錄） */}
          <div className="mb-3 flex flex-wrap gap-2">
            {CLAIM_FILTERS.map((f) => (
              <button
                key={f.value}
                type="button"
                onClick={() => setClaimFilter(f.value)}
                className={`rounded-full px-3 py-1 text-xs transition ${
                  claimFilter === f.value ? "bg-ink-soft text-cream-50" : "bg-cream-100 text-ink-soft hover:bg-cream-200"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>

          {claims === null && <p className="text-sm text-ink-faint">載入中…</p>}
          {claims !== null && displayedClaims.length === 0 && (
            <p className="text-sm text-ink-faint">
              {claimFilter === "ACTIVE" ? "目前沒有進行中的認捐紀錄。" : "目前沒有符合此篩選的認捐紀錄。"}
            </p>
          )}
          <div className="flex flex-col gap-3">
            {displayedClaims.map((claim) => (
              <ClaimRow key={claim.id} claim={claim} unit={unit} onChanged={afterClaimChange} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 編輯設定（活動層價格 / 開放狀態 / 日期 / 數量 / 備註）
// ============================================================

function EditOfferingForm({
  templeEventId,
  offering,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  offering: ActivityOfferingJSON;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [quantity, setQuantity] = useState(String(offering.quantity));
  const [useDefaultPrice, setUseDefaultPrice] = useState(offering.useDefaultPrice);
  const [price, setPrice] = useState(offering.price ?? "");
  const [status, setStatus] = useState(offering.status);
  const [startDate, setStartDate] = useState(toDateInput(offering.claimStartDate));
  const [endDate, setEndDate] = useState(toDateInput(offering.claimEndDate));
  const [note, setNote] = useState(offering.note ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const defaultPriceText = offering.offeringType.defaultPrice
    ? `${fmtMoney(offering.offeringType.defaultPrice)} 元`
    : "未設定預設單價";
  const currentText = useDefaultPrice
    ? `目前採用：預設單價（${defaultPriceText}）`
    : price === ""
      ? "目前採用：自訂單價（尚未輸入）"
      : `目前採用：自訂單價 ${fmtMoney(Number(price))} 元`;

  async function handleSubmit() {
    const q = Number(quantity);
    if (!Number.isInteger(q) || q < 1) {
      setError("需求數量請輸入正整數");
      return;
    }
    if (!useDefaultPrice) {
      const p = Number(price);
      if (price === "" || !Number.isFinite(p) || p < 0) {
        setError("自訂單價請輸入有效的非負金額");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/temple-events/${templeEventId}/offerings/${offering.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: q,
          useDefaultPrice,
          price: useDefaultPrice ? undefined : Number(price),
          status,
          claimStartDate: startDate ? startDate : null,
          claimEndDate: endDate ? endDate : null,
          note,
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
    <div className="rounded-2xl bg-mist-50 p-5">
      <h4 className="mb-3 text-sm font-medium text-ink">供品設定</h4>
      {error && <p className={errorTextClass}>{error}</p>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>需求數量</label>
          <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>認捐狀態</label>
          <select className={inputClass} value={status} onChange={(e) => setStatus(e.target.value as ActivityOfferingJSON["status"])}>
            {activityOfferingStatusOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label className="mb-1.5 flex items-center gap-2 text-sm text-ink-soft">
            <input type="checkbox" checked={useDefaultPrice} onChange={(e) => setUseDefaultPrice(e.target.checked)} />
            使用預設單價（{defaultPriceText}）
          </label>
          <input
            className={inputClass}
            type="number"
            min={0}
            value={useDefaultPrice ? "" : price}
            disabled={useDefaultPrice}
            placeholder={useDefaultPrice ? "（使用預設單價，停用自訂）" : "本次活動自訂單價"}
            onChange={(e) => setPrice(e.target.value)}
          />
          <p className="mt-1 text-xs text-ink-faint">{currentText}</p>
        </div>
        <div>
          <label className={labelClass}>開放日期</label>
          <input className={inputClass} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>截止日期</label>
          <input className={inputClass} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelClass}>備註</label>
          <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填" />
        </div>
      </div>
      <div className="mt-4 flex gap-3">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          {submitting ? "儲存中…" : "儲存設定"}
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}

// ============================================================
// 新增認捐（可選當場收費）
// ============================================================

function AddClaimForm({
  templeEventId,
  offering,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  offering: ActivityOfferingJSON;
  onDone: () => void;
  onCancel: () => void;
}) {
  const operatorUserId = useStoredOperatorUserId();
  const effPrice = effectiveUnitPrice(offering);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState(effPrice === null ? "" : String(effPrice));
  const [chargeNow, setChargeNow] = useState(false);
  const [payAmount, setPayAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const qtyNum = Number(quantity) || 0;
  const priceNum = unitPrice === "" ? 0 : Number(unitPrice);
  const amountDue = offering.isChargeable ? Math.max(0, qtyNum * priceNum) : 0;

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
      setError("請先從信眾管理搜尋並選取認捐人");
      return;
    }
    if (!Number.isInteger(qtyNum) || qtyNum < 1) {
      setError("數量請輸入正整數");
      return;
    }
    if (chargeNow) {
      const pay = Number(payAmount);
      if (!Number.isFinite(pay) || pay <= 0) {
        setError("當場收費請輸入正確的收款金額");
        return;
      }
    }
    setSubmitting(true);
    setError(null);
    try {
      // 1) 建立認捐——把當下有效單價存入 unitPrice（快照）。未當場收費時，
      //    後端一律 amountPaid=0、amountUnpaid=amountDue，不會自動計入已收。
      const res = await fetch(`/api/temple-events/${templeEventId}/offering-claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          activityOfferingId: offering.id,
          sponsorMemberId: selected.memberId,
          quantity: qtyNum,
          unitPrice: unitPrice === "" ? undefined : priceNum,
          note: note || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "新增失敗");
        return;
      }
      // 2) 若當場收費，透過既有 OfferingPayment 記錄一筆收款（財務帳本）。
      if (chargeNow) {
        const payRes = await fetch(`/api/offering-claims/${data.id}/payments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ amount: Number(payAmount), paidOn: payDate }),
        });
        if (!payRes.ok) {
          const payData = await payRes.json().catch(() => ({}));
          setError(`認捐已建立，但收款失敗：${payData.error ?? "請到認捐名單手動補收款"}`);
          onDone();
          return;
        }
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
      <h4 className="mb-3 text-sm font-medium text-ink">新增認捐</h4>
      {error && <p className={errorTextClass}>{error}</p>}
      <label className={labelClass}>認捐人（請先搜尋信眾管理，查無資料請先到家戶資料新增信眾）</label>
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

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className={labelClass}>數量</label>
          <input className={inputClass} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        </div>
        <div>
          <label className={labelClass}>單價快照（預帶本次單價，可調整）</label>
          <input className={inputClass} type="number" min={0} value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} placeholder="單價" />
        </div>
        <div>
          <label className={labelClass}>應收金額</label>
          <input className={`${inputClass} bg-cream-50`} value={fmtMoney(amountDue)} readOnly />
        </div>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
        <input type="checkbox" checked={chargeNow} onChange={(e) => setChargeNow(e.target.checked)} disabled={!offering.isChargeable} />
        當場收費（未勾選：只建立應收，已收為 0）
      </label>
      {chargeNow && (
        <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className={labelClass}>收款金額</label>
            <input className={inputClass} type="number" min={0} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder={String(amountDue)} />
          </div>
          <div>
            <label className={labelClass}>收款日期</label>
            <input className={inputClass} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          </div>
        </div>
      )}

      <div className="mt-3">
        <label className={labelClass}>備註</label>
        <input className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} placeholder="選填" />
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

// ============================================================
// 認捐名單列（修改 / 收款 / 補收款 / 取消 / 退款・沖銷）
// ============================================================

function ClaimRow({ claim, unit, onChanged }: { claim: OfferingClaimJSON; unit: string; onChanged: () => void }) {
  const [action, setAction] = useState<"none" | "pay" | "modify" | "refund">("none");
  const [amount, setAmount] = useState("");
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // 修改欄位
  const [mQuantity, setMQuantity] = useState(String(claim.quantity));
  const [mUnitPrice, setMUnitPrice] = useState(claim.unitPrice ?? "");
  const [mReason, setMReason] = useState("");

  // 退款/沖銷欄位
  const [rAmount, setRAmount] = useState(claim.amountPaid);
  const [rKind, setRKind] = useState<"REFUND" | "TRANSFER_OUT">("REFUND");
  const [rReason, setRReason] = useState("");
  const [rDate, setRDate] = useState(new Date().toISOString().slice(0, 10));

  function reset() {
    setAction("none");
    setError(null);
    setAmount("");
  }

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
        body: JSON.stringify({ amount: Number(amount), paidOn: payDate }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "收款失敗");
        return;
      }
      reset();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function saveModify() {
    const q = Number(mQuantity);
    if (!Number.isInteger(q) || q < 1) {
      setError("數量請輸入正整數");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offering-claims/${claim.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity: q,
          unitPrice: mUnitPrice === "" ? null : Number(mUnitPrice),
          changeReason: mReason || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "修改失敗");
        return;
      }
      reset();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancelClaim() {
    setBusy(true);
    try {
      const res = await fetch(`/api/offering-claims/${claim.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "取消失敗");
        return;
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function refund() {
    if (!rReason.trim()) {
      setError("請填寫退款/轉款原因");
      return;
    }
    if (!Number(rAmount) || Number(rAmount) <= 0) {
      setError("請輸入正確的退款/轉款金額");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/offering-claims/${claim.id}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: Number(rAmount), paidOn: rDate, kind: rKind, reason: rReason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "退款/沖銷失敗");
        return;
      }
      reset();
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
        <span className="ml-auto text-xs text-ink-faint">{claim.createdAt.slice(0, 10)}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs text-ink-soft sm:grid-cols-3">
        <span>數量 {claim.quantity} {unit}</span>
        <span>單價 {claim.unitPrice ? fmtMoney(claim.unitPrice) : "—"}</span>
        <span>應收 {fmtMoney(claim.amountDue)}</span>
        <span>已收 {fmtMoney(claim.amountPaid)}</span>
        <span>未收 {fmtMoney(claim.amountUnpaid)}</span>
      </div>

      {error && <p className={`${errorTextClass} mt-2`}>{error}</p>}

      <div className="mt-2 flex min-h-12 flex-wrap items-center gap-2">
        {claim.status === "ACTIVE" && (
          <>
            <button type="button" onClick={() => setAction(action === "pay" ? "none" : "pay")} className={secondaryButtonClass}>
              {Number(claim.amountPaid) > 0 ? "補收款" : "確認收款"}
            </button>
            <button type="button" onClick={() => setAction(action === "modify" ? "none" : "modify")} className={secondaryButtonClass}>
              修改
            </button>
            <button type="button" onClick={cancelClaim} disabled={busy} className={secondaryButtonClass}>
              取消
            </button>
          </>
        )}
        {claim.status === "REFUND_PENDING" && (
          <button type="button" onClick={() => setAction(action === "refund" ? "none" : "refund")} className={secondaryButtonClass}>
            退款／沖銷
          </button>
        )}
      </div>

      {action === "pay" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className={`${inputClass} max-w-[10rem]`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="收款金額" />
          <input className={`${inputClass} max-w-[12rem]`} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} />
          <button type="button" onClick={recordPayment} disabled={busy} className={`${primaryButtonClass} min-h-12`}>
            確認收款
          </button>
        </div>
      )}

      {action === "modify" && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <div>
            <label className={labelClass}>數量</label>
            <input className={inputClass} type="number" min={1} value={mQuantity} onChange={(e) => setMQuantity(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>單價</label>
            <input className={inputClass} type="number" min={0} value={mUnitPrice} onChange={(e) => setMUnitPrice(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>修改原因</label>
            <input className={inputClass} value={mReason} onChange={(e) => setMReason(e.target.value)} placeholder="選填" />
          </div>
          <div className="sm:col-span-3">
            <button type="button" onClick={saveModify} disabled={busy} className={`${primaryButtonClass} min-h-12`}>
              儲存修改
            </button>
          </div>
        </div>
      )}

      {action === "refund" && (
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div>
            <label className={labelClass}>金額</label>
            <input className={inputClass} type="number" min={0} value={rAmount} onChange={(e) => setRAmount(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>方式</label>
            <select className={inputClass} value={rKind} onChange={(e) => setRKind(e.target.value as "REFUND" | "TRANSFER_OUT")}>
              <option value="REFUND">退款</option>
              <option value="TRANSFER_OUT">轉款/沖銷</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>日期</label>
            <input className={inputClass} type="date" value={rDate} onChange={(e) => setRDate(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>原因（必填）</label>
            <input className={inputClass} value={rReason} onChange={(e) => setRReason(e.target.value)} placeholder="退款/轉款原因" />
          </div>
          <div className="sm:col-span-2">
            <button type="button" onClick={refund} disabled={busy} className={`${primaryButtonClass} min-h-12`}>
              確認退款／沖銷
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================
// 加入供品（從供品種類庫加入一筆新的活動供品）
// ============================================================

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
