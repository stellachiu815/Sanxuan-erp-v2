import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { activityTypeLabel } from "@/lib/labels";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * 這一頁在「每次請求」時即時查詢資料庫，不做建置期預渲染。
 *
 * 原因（V12.3 建置修正）：App Router 的頁面預設是靜態的——只要沒有用到
 * cookies()／headers()／searchParams 這類動態 API，Next.js 就會在
 * `next build` 階段直接執行這個 Server Component 並把結果存成靜態 HTML。
 * 本頁的資料來自直接呼叫 Prisma（不是 fetch，所以也沒有 fetch 層的快取
 * 標記可以讓 Next.js 判斷「這是動態資料」），因此會發生兩個問題：
 *
 *   1. 建置階段會去連線正式資料庫。資料庫在建置當下不可達（例如在本機
 *      build、或 Render 資料庫短暫離線）就會直接 build 失敗（Prisma P1001）。
 *   2. 更嚴重的是就算建置成功，這一頁也會被凍結成建置當下的快照，
 *      之後行政人員看到的數字不會更新，要等下一次部署才會變。
 *
 * 這一頁顯示的是即時營運資料，本來就不該被快取，所以明確標記為動態渲染。
 *
 * ⚠️ 這不會吞掉執行期的資料庫錯誤：請求當下若連不上資料庫，仍會照常拋出
 * 錯誤並顯示錯誤畫面，只是不再於建置階段連線。
 */
export const dynamic = "force-dynamic";

/**
 * V10.1「供品認捐中心」需求「十七、供品認捐中心畫面」主選單。
 *
 * 這裡把規格列出的 10 個子畫面，依實際好用的方式整合成幾條主要路徑
 * （詳見交付說明的畫面整合說明）：
 * 1. 年度總覽／宮慶供品／神明聖誕供品／其他活動供品／歷年紀錄
 *    → 都是「選一個活動年度，進去看/管理這個活動的供品設定」，所以這裡
 *      直接列出所有有機會掛供品的活動（宮慶/四位主祀神明聖誕/普渡/其他），
 *      依年度分組，點進去是同一個 /offering-center/activity/[id] 畫面
 *      （年度總覽＝目前年度的分組，歷年紀錄＝可以往下捲動看到的所有年度）。
 * 2. 花果供品 → 從對應活動的供品設定裡進入專屬的花果供品名單畫面。
 * 3. 未認捐清單／未收款清單 → 從各活動的供品卡片可以看到尚缺數量；未收款
 *    清單有獨立的 /offering-center/unpaid 畫面（含跨年度未收款）。
 * 4. 供品種類設定／年度價格設定 → /offering-center/settings（供品種類）＋
 *    每個活動供品設定裡的「當次數量/價格」表單（就是年度價格設定本身）。
 */
export default async function OfferingCenterHomePage() {
  const currentYear = getCurrentRitualYear();

  const events = await prisma.templeEvent.findMany({
    where: {
      activityType: {
        in: [
          "TEMPLE_CELEBRATION",
          "GUANDI_BIRTHDAY",
          "XUANTIAN_BIRTHDAY",
          "YAOCHI_BIRTHDAY",
          "ZHONGTAN_BIRTHDAY",
          "UNIVERSAL_SALVATION",
          "OTHER",
        ],
      },
    },
    include: { _count: { select: { activityOfferings: true, stoveMasterRegistrations: true } } },
    orderBy: [{ year: "desc" }, { activityType: "asc" }],
  });

  const byYear = new Map<number, typeof events>();
  for (const e of events) {
    const list = byYear.get(e.year) ?? [];
    list.push(e);
    byYear.set(e.year, list);
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">🙏 供品認捐中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <div className="flex flex-wrap gap-3">
          <Link href="/offering-center/settings" className="rounded-full bg-mist-100 px-4 py-2 text-sm text-ink-soft hover:bg-mist-200">
            ⚙️ 供品種類設定
          </Link>
          <Link href="/offering-center/unpaid" className="rounded-full bg-blossom-100 px-4 py-2 text-sm text-ink-soft hover:bg-blossom-200">
            💰 未收款清單／跨年度未收款
          </Link>
        </div>

        {[...byYear.entries()].map(([year, yearEvents]) => (
          <section key={year} className="rounded-3xl bg-white/70 p-8 shadow-card">
            <h2 className="text-lg font-medium text-ink">
              {year} 年{year === currentYear ? "（本年度）" : ""}
            </h2>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {yearEvents.map((e) => (
                <Link
                  key={e.id}
                  href={`/offering-center/activity/${e.id}`}
                  className="rounded-2xl bg-cream-100 px-5 py-4 transition hover:bg-cream-200"
                >
                  <p className="text-base text-ink">{activityTypeLabel[e.activityType] ?? e.activityType}</p>
                  <p className="mt-1 text-xs text-ink-faint">
                    {e._count.activityOfferings} 種供品設定
                    {e._count.stoveMasterRegistrations > 0 ? `／${e._count.stoveMasterRegistrations} 筆爐主登錄` : ""}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ))}

        {byYear.size === 0 && (
          <p className="text-sm text-ink-faint">
            目前還沒有宮慶／神明聖誕／普渡／其他活動可以設定供品。請先到「宮務活動中心」建立活動，再回到這裡加入供品。
          </p>
        )}
      </main>
    </div>
  );
}
