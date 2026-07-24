"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchRegistration } from "@/lib/registrationFetch";

/**
 * V15 首頁「待列印」資訊卡（指令三）。
 *
 * 沿用既有列印彙總 API（/api/print-center/activity-items，內部
 * listActivityItemPrintSummary，依 ritualRegistrationItem.printedAt 計數），
 * 不新增資料表、不改 print object 架構，只把「還沒列印幾筆」呈現在首頁並可點進列印中心。
 *
 * 以 client 端載入（lazy）：首頁搜尋框先出現，這張卡片稍後自行補上數字，
 * 避免首頁一次查全部而變慢。
 */

type SummaryRow = { unprintedCount: number; printedCount: number; confirmedCount: number };

export default function PrintPendingCard() {
  const rocYear = new Date().getFullYear() - 1911;
  const [state, setState] = useState<{ pending: number; printed: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration(`/api/print-center/activity-items?year=${rocYear}`);
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError("暫時無法讀取"); return; }
      const rows: SummaryRow[] = data.summary ?? [];
      const pending = rows.reduce((s, r) => s + (r.unprintedCount ?? 0), 0);
      const printed = rows.reduce((s, r) => s + (r.printedCount ?? 0), 0);
      setState({ pending, printed });
      setError(null);
    } catch {
      setError("暫時無法讀取");
    }
  }, [rocYear]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="rounded-3xl bg-mist-50 p-6 shadow-card transition hover:shadow-pop">
      <p className="text-sm font-medium text-ink">🖨️ 待列印</p>
      <div className="mt-3 space-y-2">
        <div>
          <p className="text-xs text-ink-faint">待列印數（本年度未列印）</p>
          <p className="mt-1 text-lg text-ink">{state ? `${state.pending} 筆` : error ? "—" : "讀取中…"}</p>
        </div>
        <div>
          <p className="text-xs text-ink-faint">已列印數</p>
          <p className="mt-1 text-lg text-ink">{state ? `${state.printed} 筆` : error ? "—" : "讀取中…"}</p>
        </div>
      </div>
      <Link
        href="/print-center"
        className="mt-4 inline-block rounded-xl bg-mist-100 px-3 py-1 text-xs text-ink transition hover:bg-mist-200"
      >
        進入列印中心 →
      </Link>
    </div>
  );
}
