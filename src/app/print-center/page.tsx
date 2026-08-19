"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import PrintManagementCenter from "@/components/ritual/PrintManagementCenter";
import type { PrintCenterActivity } from "@/lib/printCenterOverview";

/**
 * V14→V39：列印管理首頁。
 *
 * V39 改動（純加法，普渡既有入口與連結原樣保留）：
 *   - 不再用「單一寫死民國當年」驅動整頁；改用 /api/print-center/overview，
 *     每個活動群組各自帶對年度（普渡→當年、年度燈→隔年），修掉年度燈停在
 *     115 時整組顯示 0、名單空、歲數少一歲的根因。
 *   - 依檔期自動把「當季」（今天仍可報名或可列印）的列印品項多的活動
 *     （普渡／年度燈）正式列印入口排到最顯眼。
 */

export default function PrintCenterPage() {
  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <PrintCenterInner />
      </div>
    </OperatorProvider>
  );
}

function PrintCenterInner() {
  const currentYear = new Date().getFullYear() - 1911;
  const [activities, setActivities] = useState<PrintCenterActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setActivities(null);
    try {
      const res = await fetchRegistration(`/api/print-center/overview`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setActivities(data.activities as PrintCenterActivity[]);
      setError(null);
    } catch {
      setError("讀取列印總覽時發生連線問題。");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const pu = activities?.find((a) => a.activityGroup === "UNIVERSAL_SALVATION") ?? null;
  const puYear = pu?.year ?? currentYear;
  // 當季且列印品項多的其他活動（年度燈…），正式列印入口排到最顯眼（普渡另有專屬入口區塊）。
  const seasonHeavy = (activities ?? []).filter(
    (a) => a.isPrintHeavy && a.hasEvent && a.isInSeason && a.activityGroup !== "UNIVERSAL_SALVATION"
  );
  const withItems = (activities ?? []).filter((a) => a.items.length > 0);

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg text-ink">列印管理・活動報名項目</h1>
        <p className="text-xs text-ink-faint">年度依各活動檔期自動判斷（普渡當年、年度燈隔年）</p>
      </div>

      {/* 各活動列印狀態總覽——每張卡各自帶對年度。 */}
      {activities !== null && activities.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base text-ink">各活動列印狀態</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {activities.map((a) => (
              <div
                key={a.activityGroup}
                className={`rounded-2xl p-4 shadow-card ${a.hasEvent ? "bg-white/70" : "bg-cream-50/60"}`}
              >
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-ink">{a.activityGroupName}</p>
                  {a.isInSeason && (
                    <span className="rounded-full bg-sage-100 px-2 py-0.5 text-[10px] text-sage-700">當季</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-ink-faint">
                  {a.hasEvent ? `民國 ${a.year} 年` : "尚未建立活動年度"}
                </p>
                {a.hasEvent ? (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                    <span>
                      待列印：
                      <span className={a.totals.pending > 0 ? "font-medium text-blossom-500" : "text-ink"}>
                        {a.totals.pending}
                      </span>
                    </span>
                    <span>已列印：<span className="text-ink">{a.totals.printed}</span></span>
                    <span>補印：<span className="text-ink">{a.totals.reprinted}</span></span>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink-faint">{a.reason || "請先於活動中心建立"}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/*
        中元普渡正式列印入口——原樣保留（牌位／寶袋走既有 mm 版型引擎），
        年度改用普渡自動解析的年度 puYear。只有普渡已建立活動年度時才顯示。
      */}
      {pu?.hasEvent && (
        <section className="mb-8">
          <h2 className="mb-3 text-base text-ink">中元普渡正式列印入口（民國 {puYear} 年）</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Link href={`/universal-salvation/${puYear}/print-center`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
              <p className="text-sm font-medium text-ink">牌位正式列印</p>
              <p className="mt-1 text-xs text-ink-faint">超拔祖先／乙位正魂／累世冤親債主／無緣子女——mm 版型：預覽・勾選・全部未列印・指定 ids・補印・作業號碼顯示／隱藏・確認完成列印。</p>
            </Link>
            <Link href={`/universal-salvation/${puYear}/print-center`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
              <p className="text-sm font-medium text-ink">寶袋正式列印</p>
              <p className="mt-1 text-xs text-ink-faint">基本寶袋＋額外寶袋——同一列印物件中心，每頁 4 筆、作業號碼可顯示／隱藏。</p>
            </Link>
            <Link href={`/print-center/rosters/US_RICE/${puYear}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
              <p className="text-sm font-medium text-ink">白米名單</p>
              <p className="mt-1 text-xs text-ink-faint">白米登記報名總名單（顯示斤數）／列印／補印／紀錄。</p>
            </Link>
            <Link href={`/print-center/rosters/US_SPONSOR/${puYear}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
              <p className="text-sm font-medium text-ink">贊普名單</p>
              <p className="mt-1 text-xs text-ink-faint">贊普報名總名單／列印／補印／紀錄。</p>
            </Link>
            <Link href={`/print-center/rosters/US_SPONSOR_DONATION/${puYear}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
              <p className="text-sm font-medium text-ink">隨喜贊普名單</p>
              <p className="mt-1 text-xs text-ink-faint">隨喜贊普報名總名單／列印／補印／紀錄。</p>
            </Link>
          </div>
          <p className="mt-2 text-xs text-ink-faint">＊各報名項目的「報名總名單」也可從下方「依項目快速彙總」進入；報名總名單為名冊，牌位／寶袋正式列印請走上方 mm 版型入口。</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/print-center/work-orders" className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">正式作業編號管理（workOrder）</Link>
            <Link href="/print-center/tablet-templates" className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">列印模板管理</Link>
            <Link href="/universal-salvation/template-preview" className="rounded-full bg-cream-100 px-4 py-1.5 text-sm text-ink-soft hover:bg-cream-200">列印模板測試預覽</Link>
            <a href={`/api/universal-salvation/${puYear}/roster-export`} className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300">⬇ 匯出活動總名單 Excel（祖先＋乙位／冤親／白米／贊普）</a>
            <Link href="/system-center/universal-salvation-check" className="rounded-full bg-cream-100 px-4 py-1.5 text-sm text-ink-soft hover:bg-cream-200">普渡上線前檢查（唯讀）</Link>
            <Link href={`/print-center/activity-participants?year=${puYear}`} className="rounded-full bg-sage-100 px-4 py-1.5 text-sm text-ink hover:bg-sage-200">活動參加名單（每筆項目・只讀）</Link>
            <Link href={`/print-center/print-objects?year=${puYear}`} className="rounded-full bg-sage-100 px-4 py-1.5 text-sm text-ink hover:bg-sage-200">列印物件查詢／補印準備（只讀）</Link>
          </div>
        </section>
      )}

      {/*
        當季的其他列印品項多的活動（年度燈）——正式列印入口。
        目前先以「各項目總名單」連結（roster 頁已含列印／補印）帶對年度；
        年度燈燈牌／疏文的 mm 正式版型第二批接入。
      */}
      {seasonHeavy.map((a) => (
        <section key={a.activityGroup} className="mb-8">
          <h2 className="mb-3 text-base text-ink">{a.activityGroupName}正式列印入口（民國 {a.year} 年）</h2>
          {a.items.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {a.items.map((it) => (
                <Link
                  key={it.itemKey}
                  href={`/print-center/rosters/${it.itemKey}/${a.year}`}
                  className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50"
                >
                  <p className="text-sm font-medium text-ink">{it.itemName}總名單</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    待列印 {it.unprintedCount}・已列印 {it.printedCount}・補印 {it.reprintedCount}／列印／補印／紀錄。
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-faint">此年度尚無已確認的報名。</p>
          )}
          {a.activityGroup === "ANNUAL_LANTERN" && (
            <>
              {/* V41：年度燈報名總名單 Excel＋正式作業編號管理（照燈別）。 */}
              <div className="mt-3 flex flex-wrap gap-2">
                <a
                  href={`/api/print-center/annual-lantern-roster/${a.year}`}
                  className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300"
                >
                  ⬇ 匯出年度燈報名總名單 Excel（光明／太歲／祭改／全家 分表）
                </a>
                <Link
                  href={`/print-center/annual-lantern-work-orders/${a.year}`}
                  className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300"
                >
                  正式作業編號管理（照燈別）
                </Link>
              </div>
              <p className="mt-3 mb-2 text-xs text-ink-soft">燈牌／疏文正式列印（mm 版型，含虛歲自動＋1、生肖、太歲）：</p>
              <div className="flex flex-wrap gap-2">
                <Link href={`/lantern/GUANGMING_LANTERN/print?year=${a.year}`} className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300">光明燈牌列印（橫式 42 張）</Link>
                <Link href={`/lantern/TAISUI_LANTERN/print?year=${a.year}`} className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300">太歲燈牌列印</Link>
                <Link href={`/lantern/FAMILY_LANTERN/print?year=${a.year}`} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">全家燈牌列印（一戶一張）</Link>
                {a.templeEventId && (
                  <Link href={`/purification/${a.templeEventId}/print`} className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">祭改小人頭列印（貼紙 3×11）</Link>
                )}
              </div>
              <p className="mt-2 text-xs text-ink-faint">＊疏文（直書＋封面干支）在各燈牌列印頁內以「列印內容」切換。全家燈、疏文版面續調校。</p>
            </>
          )}
        </section>
      ))}

      {/* 普渡列印管理唯一入口——所有來源共用的報名名單（自有年度篩選）。 */}
      {pu?.hasEvent && (
        <section className="mb-8">
          <h2 className="mb-3 text-base text-ink">普渡列印名單（全部來源）</h2>
          <PrintManagementCenter />
        </section>
      )}

      {/* 依項目快速彙總——每個群組各自帶對年度。 */}
      <h2 className="mb-3 text-base text-ink">依項目快速彙總</h2>
      {error && <p className="text-sm text-blossom-500">{error}</p>}
      {activities === null ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : withItems.length === 0 ? (
        <p className="text-sm text-ink-faint">目前沒有已確認的報名項目。</p>
      ) : (
        withItems.map((a) => (
          <section key={a.activityGroup} className="mb-6 rounded-3xl bg-white/70 p-5 shadow-card">
            <h2 className="mb-3 text-sm text-ink">{a.activityGroupName}（民國 {a.year} 年）</h2>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-ink-faint">
                  <th className="px-2 py-1.5">項目</th>
                  <th className="px-2 py-1.5">已確認</th>
                  <th className="px-2 py-1.5">待列印</th>
                  <th className="px-2 py-1.5">已列印</th>
                  <th className="px-2 py-1.5">補印</th>
                  <th className="px-2 py-1.5">列印／預覽／補印／紀錄／總名冊</th>
                </tr>
              </thead>
              <tbody>
                {a.items.map((it) => (
                  <tr key={it.itemKey} className="border-t border-cream-200">
                    <td className="px-2 py-1.5 text-ink">{it.itemName}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.confirmedCount}</td>
                    <td className={`px-2 py-1.5 ${it.unprintedCount > 0 ? "font-medium text-blossom-500" : "text-ink-soft"}`}>{it.unprintedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.printedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.reprintedCount}</td>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/print-center/rosters/${it.itemKey}/${a.year}`}
                        className="rounded-full bg-sage-100 px-3 py-1 text-xs text-ink hover:bg-sage-200"
                      >
                        進入總名冊／列印／預覽／補印／紀錄
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </main>
  );
}
