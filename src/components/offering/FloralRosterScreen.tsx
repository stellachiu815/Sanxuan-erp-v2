"use client";

import { useState } from "react";
import {
  inputClass,
  labelClass,
  primaryButtonClass,
  secondaryButtonClass,
  errorTextClass,
} from "@/components/household/formStyles";
import { offeringPaymentStatusLabel } from "@/lib/labels";
import type { MemberSearchResult } from "./types";

type RosterRow = {
  floralSlotId: string;
  lunarDate: string;
  sponsorName: string;
  amount: number | null;
  paymentStatus: string | null;
  receiptNumbers: string;
  note: string;
  isActive: boolean;
};

/**
 * V10.1「供品認捐中心」需求「十二、花果供品年度名單」畫面：全年 24 次
 * 一覽，依農曆日期排序，顯示尚未認捐日期／未收款資料，支援匯出 Excel、
 * 一般 A4 工作清單列印（用瀏覽器列印，不做牆面超長版型，見需求「十二」
 * 最後一句——這份名單是給宮方工作人員查看，之後由師姐人工抄寫至牆面）。
 */
export default function FloralRosterScreen({
  templeEventId,
  activityOfferingId,
  initialRoster,
}: {
  templeEventId: string;
  activityOfferingId: string;
  initialRoster: RosterRow[];
}) {
  const [roster, setRoster] = useState(initialRoster);
  const unclaimedCount = roster.filter((r) => r.sponsorName === "（尚未認捐）").length;
  const unpaidCount = roster.filter((r) => r.paymentStatus === "未收款" || r.paymentStatus === "部分收款").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        <span className="rounded-full bg-mist-100 px-3 py-1 text-sm text-ink-soft">
          尚未認捐 {unclaimedCount} 次
        </span>
        <span className="rounded-full bg-blossom-100 px-3 py-1 text-sm text-ink-soft">未收款 {unpaidCount} 筆</span>
        <div className="ml-auto flex min-h-12 gap-2">
          <a
            href={`/api/temple-events/${templeEventId}/offerings/${activityOfferingId}/floral-roster?format=xlsx`}
            className={secondaryButtonClass}
          >
            匯出 Excel
          </a>
          <button type="button" onClick={() => window.print()} className={secondaryButtonClass}>
            列印 A4 工作清單
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">農曆日期</th>
              <th className="px-4 py-3">認捐人</th>
              <th className="px-4 py-3">金額</th>
              <th className="px-4 py-3">收款狀態</th>
              <th className="px-4 py-3">收據號碼</th>
              <th className="px-4 py-3">備註</th>
              <th className="px-4 py-3 print:hidden">操作</th>
            </tr>
          </thead>
          <tbody>
            {roster.map((row, idx) => (
              <RosterRowView
                key={row.floralSlotId}
                row={row}
                templeEventId={templeEventId}
                activityOfferingId={activityOfferingId}
                onClaimed={(updated) => {
                  const next = [...roster];
                  next[idx] = updated;
                  setRoster(next);
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RosterRowView({
  row,
  templeEventId,
  activityOfferingId,
  onClaimed,
}: {
  row: RosterRow;
  templeEventId: string;
  activityOfferingId: string;
  onClaimed: (row: RosterRow) => void;
}) {
  const [showClaimForm, setShowClaimForm] = useState(false);
  const unclaimed = row.sponsorName === "（尚未認捐）";

  return (
    <tr className={`border-b border-cream-100 ${unclaimed ? "bg-mist-50/50" : ""}`}>
      <td className="px-4 py-3 text-ink">{row.lunarDate}</td>
      <td className="px-4 py-3">
        {unclaimed ? <span className="text-ink-faint">尚未認捐</span> : row.sponsorName}
      </td>
      <td className="px-4 py-3">{row.amount ?? ""}</td>
      <td className="px-4 py-3">
        {row.paymentStatus && (
          <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">
            {offeringPaymentStatusLabel[row.paymentStatus] ?? row.paymentStatus}
          </span>
        )}
      </td>
      <td className="px-4 py-3">{row.receiptNumbers}</td>
      <td className="px-4 py-3 text-ink-faint">{row.note}</td>
      <td className="px-4 py-3 print:hidden">
        {unclaimed && !showClaimForm && (
          <button type="button" onClick={() => setShowClaimForm(true)} className={`${secondaryButtonClass} min-h-12`}>
            登記認捐
          </button>
        )}
        {showClaimForm && (
          <FloralClaimForm
            templeEventId={templeEventId}
            activityOfferingId={activityOfferingId}
            floralSlotId={row.floralSlotId}
            lunarDate={row.lunarDate}
            onDone={(updated) => {
              setShowClaimForm(false);
              onClaimed(updated);
            }}
            onCancel={() => setShowClaimForm(false)}
          />
        )}
      </td>
    </tr>
  );
}

function FloralClaimForm({
  templeEventId,
  activityOfferingId,
  floralSlotId,
  lunarDate,
  onDone,
  onCancel,
}: {
  templeEventId: string;
  activityOfferingId: string;
  floralSlotId: string;
  lunarDate: string;
  onDone: (row: RosterRow) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MemberSearchResult[]>([]);
  const [selected, setSelected] = useState<MemberSearchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function search(q: string) {
    setQuery(q);
    setSelected(null);
    if (!q.trim()) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setResults((data.results ?? []).filter((r: MemberSearchResult) => r.memberId));
  }

  async function handleSubmit() {
    if (!selected?.memberId) {
      setError("請先搜尋並選取認捐人");
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
          floralSlotId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "登記失敗");
        return;
      }
      onDone({
        floralSlotId,
        lunarDate,
        sponsorName: selected.name,
        amount: null,
        paymentStatus: "未收款",
        receiptNumbers: "",
        note: "",
        isActive: true,
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl bg-sage-50 p-3">
      {error && <p className={errorTextClass}>{error}</p>}
      <label className={labelClass}>認捐人</label>
      <input className={inputClass} value={query} onChange={(e) => search(e.target.value)} placeholder="輸入姓名搜尋" />
      {results.length > 0 && !selected && (
        <div className="flex flex-col gap-1 rounded-xl bg-white p-2">
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
      <div className="flex gap-2">
        <button type="button" onClick={handleSubmit} disabled={submitting} className={`${primaryButtonClass} min-h-12`}>
          確認登記
        </button>
        <button type="button" onClick={onCancel} className={`${secondaryButtonClass} min-h-12`}>
          取消
        </button>
      </div>
    </div>
  );
}
