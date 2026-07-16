"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { OperatorProvider, useOperator } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import DevoteeCenterGate from "@/components/devotee/DevoteeCenterGate";

type StatsData = {
  stats: {
    totalDevotees: number;
    totalHouseholds: number;
    newDevoteesThisYear: number;
    activityParticipantsThisYear: number;
    solarBirthdaysThisMonth: number;
    lunarBirthdaysThisMonth: number;
    needsCareCount: number;
    deceasedCount: number;
    recentNewDevotees: { memberId: string; name: string; householdName: string; createdAt: string }[];
    recentInteractions: { id: string; memberId: string; name: string; interactionType: string; occurredAt: string; content: string }[];
  };
  recentLists: {
    todayBirthdays: { memberId: string; name: string; householdName: string }[];
    upcoming7DayBirthdays: { memberId: string; name: string; householdName: string }[];
    recentActivities: { memberId: string; name: string; householdName: string; activityLabel: string; year: number }[];
    recentPayments: { transactionId: string; payerName: string; amount: string; paidOn: string }[];
    recentOfferingClaims: { claimId: string; sponsorName: string; offeringTypeName: string; year: number }[];
    recentNotes: { memberId: string | null; name: string | null; personalNote: string; changedAt: string }[];
    recentDataChanges: { entityType: string; action: string; operatorName: string | null; changeNote: string | null; createdAt: string }[];
  };
};

const TILES = [
  { href: "/devotee-center/list", label: "📋 信眾名單", desc: "搜尋／篩選／分頁", color: "bg-yolk-100 hover:bg-yolk-200" },
  { href: "/devotee-center/care", label: "💗 需要關懷名單", desc: "已標記 + 系統建議", color: "bg-blossom-100 hover:bg-blossom-200" },
  { href: "/devotee-center/tags", label: "🏷️ 標籤管理", desc: "新增／停用自訂標籤", color: "bg-mist-100 hover:bg-mist-200" },
  { href: "/devotee-center/search", label: "🔎 全宮整合搜尋", desc: "跨模組搜尋，點擊跳轉", color: "bg-sage-100 hover:bg-sage-200" },
  { href: "/devotee-center/duplicates", label: "🧩 疑似重複信眾", desc: "僅供人工確認", color: "bg-cream-200 hover:bg-cream-300" },
];

function StatCard({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div className={`rounded-2xl ${color} p-4`}>
      <p className="text-xs text-ink-faint">{label}</p>
      <p className="mt-1 text-xl text-ink">{value}</p>
    </div>
  );
}

function DevoteeHomeInner() {
  const { operatorUserId } = useOperator();
  const [data, setData] = useState<StatsData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!operatorUserId) return;
    setError(null);
    fetch(`/api/devotee-center/stats?operatorUserId=${encodeURIComponent(operatorUserId)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "載入失敗");
        return res.json();
      })
      .then((d) => setData(d))
      .catch((e) => setError(e.message));
  }, [operatorUserId]);

  return (
    <div className="flex flex-col gap-8">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {TILES.map((t) => (
          <Link key={t.href} href={t.href} className={`rounded-3xl p-6 shadow-card transition ${t.color}`}>
            <p className="text-base text-ink">{t.label}</p>
            <p className="mt-1 text-xs text-ink-faint">{t.desc}</p>
          </Link>
        ))}
      </div>

      {error && (
        <div className="rounded-3xl bg-blossom-100 p-4 text-sm text-ink">{error}</div>
      )}

      {data && (
        <>
          <section className="rounded-3xl bg-white/70 p-6 shadow-card">
            <h2 className="text-base font-medium text-ink">統計總覽</h2>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard label="信眾總人數" value={data.stats.totalDevotees} color="bg-yolk-100" />
              <StatCard label="家戶總數" value={data.stats.totalHouseholds} color="bg-sage-100" />
              <StatCard label="本年度新增信眾" value={data.stats.newDevoteesThisYear} color="bg-blossom-100" />
              <StatCard label="本年度參加活動人數" value={data.stats.activityParticipantsThisYear} color="bg-mist-100" />
              <StatCard label="本月國曆生日人數" value={data.stats.solarBirthdaysThisMonth} color="bg-cream-200" />
              <StatCard label="本月農曆生日人數" value={data.stats.lunarBirthdaysThisMonth} color="bg-yolk-100" />
              <StatCard label="需要關懷人數" value={data.stats.needsCareCount} color="bg-blossom-100" />
              <StatCard label="已標示往生人數" value={data.stats.deceasedCount} color="bg-sage-100" />
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <RecentBox title="最近新增信眾">
              {data.stats.recentNewDevotees.map((m) => (
                <RecentRow key={m.memberId} href={`/devotee-center/${m.memberId}`} primary={m.name} secondary={m.householdName} />
              ))}
            </RecentBox>
            <RecentBox title="最近互動紀錄">
              {data.stats.recentInteractions.map((i) => (
                <RecentRow key={i.id} href={`/devotee-center/${i.memberId}`} primary={i.name} secondary={i.content} />
              ))}
            </RecentBox>
            <RecentBox title="今日生日">
              {data.recentLists.todayBirthdays.map((b) => (
                <RecentRow key={b.memberId} href={`/devotee-center/${b.memberId}`} primary={b.name} secondary={b.householdName} />
              ))}
            </RecentBox>
            <RecentBox title="未來七日生日">
              {data.recentLists.upcoming7DayBirthdays.map((b) => (
                <RecentRow key={b.memberId} href={`/devotee-center/${b.memberId}`} primary={b.name} secondary={b.householdName} />
              ))}
            </RecentBox>
            <RecentBox title="最近參加活動">
              {data.recentLists.recentActivities.map((a, idx) => (
                <RecentRow key={idx} href={`/devotee-center/${a.memberId}`} primary={a.name} secondary={`${a.activityLabel}・民國${a.year}年`} />
              ))}
            </RecentBox>
            <RecentBox title="最近收款">
              {data.recentLists.recentPayments.map((p) => (
                <RecentRow key={p.transactionId} href={`/collection-center/payments/${p.transactionId}`} primary={p.payerName} secondary={`$${p.amount}・${p.paidOn}`} />
              ))}
            </RecentBox>
            <RecentBox title="最近供品認捐">
              {data.recentLists.recentOfferingClaims.map((c) => (
                <RecentRow key={c.claimId} href="#" primary={c.sponsorName} secondary={`${c.offeringTypeName}・民國${c.year}年`} />
              ))}
            </RecentBox>
            <RecentBox title="最近新增備註">
              {data.recentLists.recentNotes.map((n, idx) => (
                <RecentRow key={idx} href={n.memberId ? `/devotee-center/${n.memberId}` : "#"} primary={n.name ?? "（未知）"} secondary={n.personalNote} />
              ))}
            </RecentBox>
            <RecentBox title="最近資料異動">
              {data.recentLists.recentDataChanges.map((d, idx) => (
                <RecentRow key={idx} href="#" primary={`${d.entityType}・${d.action}`} secondary={`${d.operatorName ?? "（未填）"}：${d.changeNote ?? ""}`} />
              ))}
            </RecentBox>
          </section>
        </>
      )}
    </div>
  );
}

function RecentBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl bg-white/70 p-5 shadow-soft">
      <h3 className="text-sm font-medium text-ink">{title}</h3>
      <div className="mt-3 flex flex-col gap-2">
        {children}
        {!children || (Array.isArray(children) && children.length === 0) ? (
          <p className="text-xs text-ink-faint">（目前沒有資料）</p>
        ) : null}
      </div>
    </div>
  );
}

function RecentRow({ href, primary, secondary }: { href: string; primary: string; secondary: string }) {
  return (
    <Link href={href} className="flex items-center justify-between rounded-xl px-3 py-2 text-sm hover:bg-cream-100">
      <span className="text-ink">{primary}</span>
      <span className="text-xs text-ink-faint">{secondary}</span>
    </Link>
  );
}

export default function DevoteeCenterHomePage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">💛 信眾關係中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <DevoteeCenterGate>
            <DevoteeHomeInner />
          </DevoteeCenterGate>
        </OperatorProvider>
      </main>
    </div>
  );
}
