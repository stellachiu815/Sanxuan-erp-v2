"use client";

import { useState } from "react";
import Link from "next/link";
import { receivableSourceTypeLabel, universalPaymentStatusLabel } from "@/lib/labels";
import type { UniversalReceivableViewJSON } from "./types";

/** V11.0 需求「待收款項」畫面：所有已串接來源的未收/部分收款清單。 */
export default function PendingReceivablesScreen({
  initialRows,
  currentYear,
  initialOnlyCrossYear = false,
}: {
  initialRows: UniversalReceivableViewJSON[];
  currentYear: number;
  initialOnlyCrossYear?: boolean;
}) {
  const [onlyCrossYear, setOnlyCrossYear] = useState(initialOnlyCrossYear);
  const [rows, setRows] = useState(initialRows);
  const [loading, setLoading] = useState(false);

  async function toggle(next: boolean) {
    setOnlyCrossYear(next);
    setLoading(true);
    const res = await fetch(`/api/collection-center/pending${next ? "?onlyCrossYear=1" : ""}`);
    const data = await res.json();
    setRows(data.rows ?? []);
    setLoading(false);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex min-h-12 items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={onlyCrossYear} onChange={(e) => toggle(e.target.checked)} />
          只顯示跨年度未收款（原始年度早於 {currentYear} 年）
        </label>
        <Link href="/collection-center/quick-payment" className="rounded-full bg-sage-100 px-4 py-2 text-sm text-ink-soft hover:bg-sage-200">
          ⚡ 前往快速收款
        </Link>
      </div>

      {loading && <p className="text-sm text-ink-faint">載入中…</p>}

      <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-cream-200 text-xs text-ink-faint">
              <th className="px-4 py-3">年度</th>
              <th className="px-4 py-3">來源</th>
              <th className="px-4 py-3">項目</th>
              <th className="px-4 py-3">應收人</th>
              <th className="px-4 py-3">應收</th>
              <th className="px-4 py-3">已收</th>
              <th className="px-4 py-3">未收</th>
              <th className="px-4 py-3">狀態</th>
              <th className="px-4 py-3">備註</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={`${r.sourceType}-${r.sourceId}`} className={`border-b border-cream-100 ${r.isCrossYear ? "bg-yolk-50/60" : ""}`}>
                <td className="px-4 py-3">{r.sourceYear}</td>
                <td className="px-4 py-3">{receivableSourceTypeLabel[r.sourceType] ?? r.sourceType}</td>
                <td className="px-4 py-3">
                  <p>
                    {r.sourceUrl ? (
                      <Link href={r.sourceUrl} className="hover:underline">
                        {r.itemName}
                      </Link>
                    ) : (
                      r.itemName
                    )}
                  </p>
                  {r.activityName && <p className="text-xs text-ink-faint">{r.activityName}</p>}
                </td>
                <td className="px-4 py-3">{r.payerName}</td>
                <td className="px-4 py-3">{r.receivableAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.paidAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{r.unpaidAmount.toLocaleString("zh-Hant")}</td>
                <td className="px-4 py-3">{universalPaymentStatusLabel[r.paymentStatus] ?? r.paymentStatus}</td>
                <td className="px-4 py-3 text-xs text-ink-faint">
                  {!r.canCollect && (r.cannotCollectReason ?? "目前無法收款")}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={9} className="px-4 py-6 text-center text-ink-faint">
                  目前沒有待收款項
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
