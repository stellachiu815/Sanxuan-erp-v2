"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import { fetchRegistration, toFriendlyError } from "@/lib/registrationFetch";
import PrintManagementCenter from "@/components/ritual/PrintManagementCenter";

/**
 * V14：列印管理首頁「活動報名項目」區塊（指令五）。
 *
 * 依年度、主活動、報名項目分組，每個項目顯示已確認人數／未列印／已列印，
 * 並提供「進入總名單」與「列印／補印」入口。所有需要列印的活動都能從這裡進入，
 * 不只靠直達網址。
 */

type SummaryRow = {
  itemKey: string;
  itemName: string;
  activityGroup: string;
  activityGroupName: string;
  year: number;
  confirmedCount: number;
  printedCount: number;
  unprintedCount: number;
  reprintedCount: number;
  printDocumentKeys: string[];
};

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
  const [year, setYear] = useState<number>(currentYear);
  const [rows, setRows] = useState<SummaryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const res = await fetchRegistration(`/api/print-center/activity-items?year=${year}`);
      const data = await res.json();
      if (!res.ok) {
        setError(toFriendlyError(res.status, data?.error));
        return;
      }
      setRows(data.summary);
      setError(null);
    } catch {
      setError("讀取列印彙總時發生連線問題。");
    }
  }, [year]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = new Map<string, SummaryRow[]>();
  for (const r of rows ?? []) {
    (groups.get(r.activityGroupName) ?? groups.set(r.activityGroupName, []).get(r.activityGroupName)!).push(r);
  }

  // V21 列印中心首頁：各活動（主活動群組）待列印／已列印／需補印彙總。
  const groupTotals = Array.from(groups.entries()).map(([groupName, items]) => ({
    groupName,
    pending: items.reduce((s, it) => s + it.unprintedCount, 0),
    printed: items.reduce((s, it) => s + it.printedCount, 0),
    reprinted: items.reduce((s, it) => s + it.reprintedCount, 0),
  }));

  return (
    <main className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg text-ink">列印管理・活動報名項目</h1>
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          年度
          <input
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value) || currentYear)}
            className="w-24 rounded-xl border border-cream-300 px-3 py-1.5 text-sm"
          />
        </label>
      </div>

      {/* V21：各活動列印狀態總覽（待列印／已列印／需補印）。 */}
      {rows !== null && groupTotals.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-base text-ink">各活動列印狀態（民國 {year} 年）</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {groupTotals.map((g) => (
              <div key={g.groupName} className="rounded-2xl bg-white/70 p-4 shadow-card">
                <p className="text-sm font-medium text-ink">{g.groupName}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                  <span>待列印：<span className={g.pending > 0 ? "font-medium text-blossom-500" : "text-ink"}>{g.pending}</span></span>
                  <span>已列印：<span className="text-ink">{g.printed}</span></span>
                  <span>補印：<span className="text-ink">{g.reprinted}</span></span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/*
        V30.5：中元普渡正式列印入口——清楚區分「報名總名單」與「牌位／寶袋正式列印」。
        報名總名單＝名冊（下方各項目連結）；牌位／寶袋正式列印＝既有 mm 引擎版型頁（預覽／勾選列印／
        全部未列印／指定 ids／補印／作業號碼顯示隱藏／確認完成列印）。不得把報名總名單當成牌位正式列印頁。
        本輪只補入口與連結，不重做既有正式版型與 mm 引擎。
      */}
      <section className="mb-8">
        <h2 className="mb-3 text-base text-ink">中元普渡正式列印入口（民國 {year} 年）</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link href={`/universal-salvation/${year}/print-center`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
            <p className="text-sm font-medium text-ink">牌位正式列印</p>
            <p className="mt-1 text-xs text-ink-faint">超拔祖先／乙位正魂／累世冤親債主／無緣子女——mm 版型：預覽・勾選・全部未列印・指定 ids・補印・作業號碼顯示／隱藏・確認完成列印。</p>
          </Link>
          <Link href={`/universal-salvation/${year}/print-center`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
            <p className="text-sm font-medium text-ink">寶袋正式列印</p>
            <p className="mt-1 text-xs text-ink-faint">基本寶袋＋額外寶袋——同一列印物件中心，每頁 4 筆、作業號碼可顯示／隱藏。</p>
          </Link>
          <Link href={`/print-center/rosters/US_RICE/${year}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
            <p className="text-sm font-medium text-ink">白米名單</p>
            <p className="mt-1 text-xs text-ink-faint">白米登記報名總名單（顯示斤數）／列印／補印／紀錄。</p>
          </Link>
          <Link href={`/print-center/rosters/US_SPONSOR/${year}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
            <p className="text-sm font-medium text-ink">贊普名單</p>
            <p className="mt-1 text-xs text-ink-faint">贊普報名總名單／列印／補印／紀錄。</p>
          </Link>
          <Link href={`/print-center/rosters/US_SPONSOR_DONATION/${year}`} className="rounded-2xl bg-white/70 p-4 shadow-card hover:bg-cream-50">
            <p className="text-sm font-medium text-ink">隨喜贊普名單</p>
            <p className="mt-1 text-xs text-ink-faint">隨喜贊普報名總名單／列印／補印／紀錄。</p>
          </Link>
        </div>
        <p className="mt-2 text-xs text-ink-faint">＊各報名項目的「報名總名單」也可從下方「依項目快速彙總」進入；報名總名單為名冊，牌位／寶袋正式列印請走上方 mm 版型入口。</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/print-center/work-orders" className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">正式作業編號管理（workOrder）</Link>
          <Link href="/print-center/tablet-templates" className="rounded-full bg-mist-200 px-4 py-1.5 text-sm text-ink hover:bg-mist-300">列印模板管理</Link>
          <Link href="/universal-salvation/template-preview" className="rounded-full bg-cream-100 px-4 py-1.5 text-sm text-ink-soft hover:bg-cream-200">列印模板測試預覽</Link>
          <a href={`/api/universal-salvation/${year}/roster-export`} className="rounded-full bg-yolk-200 px-4 py-1.5 text-sm text-ink hover:bg-yolk-300">⬇ 匯出活動總名單 Excel（祖先＋乙位／冤親／白米／贊普）</a>
          <Link href="/system-center/universal-salvation-check" className="rounded-full bg-cream-100 px-4 py-1.5 text-sm text-ink-soft hover:bg-cream-200">普渡上線前檢查（唯讀）</Link>
          {/* V34（平行開發）橫式列印版型：與現行版並存、不取代；一鍵預覽該批次未列印且完整者。 */}
          <Link href={`/universal-salvation/${year}/print-center/print-v34?batch=ancestor-soul&density=standard`} className="rounded-full bg-blossom-100 px-4 py-1.5 text-sm text-ink hover:bg-blossom-200">V34 橫式列印・祖先／乙位（實驗）</Link>
          <Link href={`/universal-salvation/${year}/print-center/print-v34?batch=creditor&density=standard`} className="rounded-full bg-blossom-100 px-4 py-1.5 text-sm text-ink hover:bg-blossom-200">V34 橫式列印・冤親（實驗）</Link>
          <Link href={`/universal-salvation/${year}/print-center/print-v34?batch=pocket&density=standard`} className="rounded-full bg-blossom-100 px-4 py-1.5 text-sm text-ink hover:bg-blossom-200">V34 橫式列印・寶袋（實驗）</Link>
        </div>
      </section>

      {/* V15R8：普渡列印管理唯一入口——所有來源共用的報名名單（搜尋／篩選／狀態／單筆＋批次＋全部列印）。 */}
      <section className="mb-8">
        <h2 className="mb-3 text-base text-ink">普渡列印名單（全部來源）</h2>
        <PrintManagementCenter />
      </section>

      <h2 className="mb-3 text-base text-ink">依項目快速彙總</h2>
      {error && <p className="text-sm text-blossom-500">{error}</p>}
      {rows === null ? (
        <p className="text-sm text-ink-faint">讀取中…</p>
      ) : (
        Array.from(groups.entries()).map(([groupName, items]) => (
          <section key={groupName} className="mb-6 rounded-3xl bg-white/70 p-5 shadow-card">
            <h2 className="mb-3 text-sm text-ink">{groupName}</h2>
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
                {items.map((it) => (
                  <tr key={it.itemKey} className="border-t border-cream-200">
                    <td className="px-2 py-1.5 text-ink">{it.itemName}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.confirmedCount}</td>
                    <td className={`px-2 py-1.5 ${it.unprintedCount > 0 ? "font-medium text-blossom-500" : "text-ink-soft"}`}>{it.unprintedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.printedCount}</td>
                    <td className="px-2 py-1.5 text-ink-soft">{it.reprintedCount}</td>
                    <td className="px-2 py-1.5">
                      <Link
                        href={`/print-center/rosters/${it.itemKey}/${it.year}`}
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
