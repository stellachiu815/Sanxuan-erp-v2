"use client";

import { useState } from "react";
import { offeringPaymentStatusLabel } from "@/lib/labels";
import type { OfferingClaimJSON } from "./types";

/**
 * V10.1「供品認捐中心」需求「七、十六」未收款清單／跨年度未收款提醒。
 */
export default function UnpaidListScreen({
  initialClaims,
  currentYear,
  initialOnlyCrossYear = false,
}: {
  initialClaims: (OfferingClaimJSON & { offeringType?: { name: string } })[];
  currentYear: number;
  initialOnlyCrossYear?: boolean;
}) {
  const [onlyCrossYear, setOnlyCrossYear] = useState(initialOnlyCrossYear);
  const [claims, setClaims] = useState(initialClaims);
  const [loading, setLoading] = useState(false);

  async function toggleCrossYear(next: boolean) {
    setOnlyCrossYear(next);
    setLoading(true);
    const res = await fetch(`/api/offering-claims/unpaid${next ? "?crossYear=1" : ""}`);
    const data = await res.json();
    setClaims(data.claims ?? []);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex min-h-12 items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={onlyCrossYear} onChange={(e) => toggleCrossYear(e.target.checked)} />
        只顯示跨年度未收款（認捐年度早於 {currentYear} 年）
      </label>

      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">年度</th>
              <th className="px-4 py-3">供品</th>
              <th className="px-4 py-3">認捐人</th>
              <th className="px-4 py-3">應收</th>
              <th className="px-4 py-3">已收</th>
              <th className="px-4 py-3">未收</th>
              <th className="px-4 py-3">狀態</th>
            </tr>
          </thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id} className={`border-b border-cream-100 ${c.year < currentYear ? "bg-blossom-50/50" : ""}`}>
                <td className="px-4 py-3">{c.year}</td>
                <td className="px-4 py-3">{c.offeringType?.name ?? ""}</td>
                <td className="px-4 py-3">{c.sponsorNameSnapshot}</td>
                <td className="px-4 py-3">{Number(c.amountDue).toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{Number(c.amountPaid).toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{Number(c.amountUnpaid).toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">
                  <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">
                    {offeringPaymentStatusLabel[c.paymentStatus] ?? c.paymentStatus}
                  </span>
                </td>
              </tr>
            ))}
            {claims.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-ink-faint">
                  目前沒有未收款資料
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
