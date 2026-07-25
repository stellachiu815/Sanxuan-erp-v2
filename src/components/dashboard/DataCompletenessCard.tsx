"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { fetchRegistration } from "@/lib/registrationFetch";

/**
 * V15R3 首頁「資料待補」卡（純讀取）。沿用既有 dataCompleteness／彙總 API，
 * 顯示待補總數與各活動缺項筆數，可點入待補清單頁。client 端 lazy 載入，不阻塞首頁。
 */
type Summary = {
  total: number;
  annualLantern: number;
  universalSalvationTabletAddress: number;
  universalSalvationOther: number;
  dragonPhoenix: number;
};

export default function DataCompletenessCard() {
  const [s, setS] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetchRegistration("/api/data-completeness/summary");
      const data = await res.json().catch(() => null);
      if (!res.ok) { setError("暫時無法讀取"); return; }
      setS(data.summary);
      setError(null);
    } catch {
      setError("暫時無法讀取");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const num = (n: number | undefined) => (s ? `${n ?? 0} 筆` : error ? "—" : "讀取中…");

  return (
    <div className="rounded-3xl bg-blossom-50 p-6 shadow-card transition hover:shadow-pop">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">⚠️ 資料待補</p>
        {s && s.total > 0 && (
          <span className="rounded-full bg-blossom-200 px-2 py-0.5 text-xs text-ink">{s.total} 筆</span>
        )}
      </div>
      <div className="mt-3 space-y-1.5 text-sm">
        <div className="flex justify-between"><span className="text-ink-faint">年度燈待補</span><span className="text-ink">{num(s?.annualLantern)}</span></div>
        <div className="flex justify-between"><span className="text-ink-faint">普渡缺牌位地址</span><span className="text-ink">{num(s?.universalSalvationTabletAddress)}</span></div>
        <div className="flex justify-between"><span className="text-ink-faint">普渡其他缺項</span><span className="text-ink">{num(s?.universalSalvationOther)}</span></div>
        <div className="flex justify-between"><span className="text-ink-faint">龍鳳燈待補</span><span className="text-ink">{num(s?.dragonPhoenix)}</span></div>
      </div>
      <Link
        href="/data-completeness"
        className="mt-4 inline-block rounded-xl bg-blossom-100 px-3 py-1 text-xs text-ink transition hover:bg-blossom-200"
      >
        前往待補清單 →
      </Link>
    </div>
  );
}
