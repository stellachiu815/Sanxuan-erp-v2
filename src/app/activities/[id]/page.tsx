import { notFound } from "next/navigation";
import Link from "next/link";
import { getTempleEventHome } from "@/lib/templeEvents";
import { listGenericParticipants, listTempleEventExpenses } from "@/lib/templeEvents";
import ActivityHomeScreen from "@/components/activities/ActivityHomeScreen";
import PocketPriceCard from "@/components/activities/PocketPriceCard";
import SponsorPriceCard from "@/components/activities/SponsorPriceCard";
import TabletPriceCard from "@/components/activities/TabletPriceCard";
import WhiteRicePanel from "@/components/universal-salvation/WhiteRicePanel";
import { resolvePocketUnitPrice } from "@/lib/pocketPricing";
import { prisma } from "@/lib/prisma";

export default async function ActivityHomePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const home = await getTempleEventHome(id);
  if (!home) {
    // 說明同 household/[id]/page.tsx：多這行 throw 讓 TS 自己就能證明
    // 往下走 home 一定非 null，不依賴 next/navigation 的型別宣告。
    notFound();
    throw new Error("temple event home not found");
  }

  const [participants, expenses] = await Promise.all([
    listGenericParticipants(id),
    listTempleEventExpenses(id),
  ]);

  /**
   * V13.3B：寶袋預設單價（只有普渡活動需要）。
   * 讀 TempleEvent.pocketUnitPrice，null 時由 resolvePocketUnitPrice 補 300。
   */
  const eventPricing = await prisma.templeEvent.findUnique({
    where: { id },
    select: {
      activityType: true,
      year: true,
      pocketUnitPrice: true,
      sponsorUnitPrice: true,
      ancestorUnitPrice: true,
      zhenghunUnitPrice: true,
      yuanqinUnitPrice: true,
      wuyuanUnitPrice: true,
    },
  });
  const rawPocketPrice = eventPricing?.pocketUnitPrice
    ? Number(eventPricing.pocketUnitPrice)
    : null;
  const rawSponsorPrice = eventPricing?.sponsorUnitPrice
    ? Number(eventPricing.sponsorUnitPrice)
    : null;
  const tabletPrices = {
    ancestorUnitPrice: eventPricing?.ancestorUnitPrice ? Number(eventPricing.ancestorUnitPrice) : null,
    zhenghunUnitPrice: eventPricing?.zhenghunUnitPrice ? Number(eventPricing.zhenghunUnitPrice) : null,
    yuanqinUnitPrice: eventPricing?.yuanqinUnitPrice ? Number(eventPricing.yuanqinUnitPrice) : null,
    wuyuanUnitPrice: eventPricing?.wuyuanUnitPrice ? Number(eventPricing.wuyuanUnitPrice) : null,
  };

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/activities" className="text-sm text-ink-soft hover:underline">
            ← 宮務活動中心
          </Link>
          <h1 className="text-sm text-ink-soft">{home.name}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        {eventPricing?.activityType === "UNIVERSAL_SALVATION" && (
          <>
            <PocketPriceCard
              templeEventId={id}
              year={eventPricing.year}
              initialPocketUnitPrice={rawPocketPrice}
              initialEffectivePrice={resolvePocketUnitPrice(rawPocketPrice)}
            />
            <SponsorPriceCard
              templeEventId={id}
              year={eventPricing.year}
              initialSponsorUnitPrice={rawSponsorPrice}
            />
            <TabletPriceCard
              templeEventId={id}
              year={eventPricing.year}
              initialPrices={tabletPrices}
            />
            {/* V14.4：白米年度配額設定＋即時摘要（沿用同一年度活動設定頁，不另建設定中心）。 */}
            <WhiteRicePanel templeEventId={id} year={eventPricing.year} />
            {/* V14.4：普渡列印中心入口（牌位／寶袋列印物件；沿用既有跨家戶列印中心）。 */}
            <Link
              href={`/universal-salvation/${eventPricing.year}/print-center`}
              className="rounded-3xl bg-white/70 p-4 text-sm text-ink-soft shadow-card hover:bg-white"
            >
              🖨 普渡列印中心（牌位／寶袋，確認完成列印）→
            </Link>
            {/* V14.4 Part 6B：普渡 Excel 匯入入口（沿用普渡年度，不建第二個活動中心）。 */}
            <Link
              href={`/universal-salvation/${eventPricing.year}/import`}
              className="rounded-3xl bg-white/70 p-4 text-sm text-ink-soft shadow-card hover:bg-white"
            >
              📥 從 Excel 匯入普渡報名（上傳→預檢→草稿→確認）→
            </Link>
          </>
        )}

        <ActivityHomeScreen
          templeEventId={id}
          initialHome={{
            ...home,
            // 跟下面 participants／expenses 一樣，把 Date 轉成 ISO 字串再傳給
            // Client Component；這裡之前漏轉，型別上一直是「傳未序列化的
            // Date 給只接受 string 的 checklist.completedAt」，只是先前
            // 被上層「home 可能是 null」的錯誤蓋住沒被發現。
            checklist: home.checklist.map((c) => ({
              ...c,
              completedAt: c.completedAt ? c.completedAt.toISOString() : null,
            })),
          }}
          initialParticipants={participants.map((p) => ({
            ...p,
            createdAt: p.createdAt.toISOString(),
          }))}
          initialExpenses={expenses.map((e) => ({
            id: e.id,
            category: e.category,
            amount: e.amount.toString(),
            occurredOn: e.occurredOn.toISOString(),
            description: e.description,
          }))}
        />
      </main>
    </div>
  );
}
