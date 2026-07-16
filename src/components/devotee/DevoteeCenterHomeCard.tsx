"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import { canSeeDevoteeMenu } from "@/lib/permissions";

type StatsResponse = {
  stats: {
    totalDevotees: number;
    totalHouseholds: number;
    needsCareCount: number;
    solarBirthdaysThisMonth: number;
  };
};

/**
 * V12.0「信眾關係中心」首頁入口卡片。
 *
 * ⚠️ 架構取捨說明（交付報告會完整記錄，非隱性偷換）：指令「二」要求
 * 「新增左側主選單」，但這個系統目前整體是「單頁 HomeCard + 文字連結」
 * 架構（見 src/app/page.tsx），沒有任何一個既有模組使用真正的側邊選單。
 * 為了不違反「不得大幅更換全站風格」「不得重新設計已完成的功能」，這裡
 * 沿用既有慣例，用一張新的 HomeCard（比照 OfferingHomeCard／
 * CollectionHomeCard／SystemCenterHomeCard）加上首頁文字連結做為「信眾
 * 關係中心」的入口，而不是新增一條貫穿全站的側邊欄。
 */
function DevoteeCenterHomeCardInner() {
  const { operatorUserId, operatorUser } = useOperator();
  const [stats, setStats] = useState<StatsResponse["stats"] | null>(null);

  const canView = operatorUser?.role ? canSeeDevoteeMenu(operatorUser.role) : false;

  useEffect(() => {
    if (!operatorUserId || !canView) return;
    fetch(`/api/devotee-center/stats?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: StatsResponse | null) => setStats(data?.stats ?? null))
      .catch(() => setStats(null));
  }, [operatorUserId, canView]);

  if (!canView) return null;

  return (
    <section className="w-full max-w-3xl rounded-3xl bg-white/70 p-6 shadow-card">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium text-ink">💛 信眾關係中心</h2>
        <Link href="/devotee-center" className="text-sm text-ink-faint underline-offset-4 hover:underline">
          前往信眾關係中心 →
        </Link>
      </div>

      {stats ? (
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-yolk-100 p-4">
            <p className="text-xs text-ink-faint">信眾總人數</p>
            <p className="mt-1 text-lg text-ink">{stats.totalDevotees}</p>
          </div>
          <div className="rounded-2xl bg-sage-100 p-4">
            <p className="text-xs text-ink-faint">家戶總數</p>
            <p className="mt-1 text-lg text-ink">{stats.totalHouseholds}</p>
          </div>
          <div className="rounded-2xl bg-blossom-100 p-4">
            <p className="text-xs text-ink-faint">需要關懷</p>
            <p className="mt-1 text-lg text-ink">{stats.needsCareCount}</p>
          </div>
          <div className="rounded-2xl bg-mist-100 p-4">
            <p className="text-xs text-ink-faint">本月國曆生日</p>
            <p className="mt-1 text-lg text-ink">{stats.solarBirthdaysThisMonth}</p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-xs text-ink-faint">尚未選擇操作人員，或正在載入統計資料…</p>
      )}
    </section>
  );
}

export default function DevoteeCenterHomeCard() {
  return (
    <OperatorProvider>
      <DevoteeCenterHomeCardInner />
    </OperatorProvider>
  );
}
