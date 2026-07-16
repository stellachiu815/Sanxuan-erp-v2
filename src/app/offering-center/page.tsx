import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { activityTypeLabel } from "@/lib/labels";
import { getCurrentRitualYear } from "@/lib/ritual";

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
