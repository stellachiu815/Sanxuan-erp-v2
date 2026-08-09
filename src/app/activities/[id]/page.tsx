import { notFound } from "next/navigation";
import BackButton from "@/components/navigation/BackButton";
import { getTempleEventHome } from "@/lib/templeEvents";
import { listGenericParticipants, listTempleEventExpenses } from "@/lib/templeEvents";
import ActivityHomeScreen from "@/components/activities/ActivityHomeScreen";
import ActivityFlowHub from "@/components/activities/ActivityFlowHub";
import PocketPriceCard from "@/components/activities/PocketPriceCard";
import SponsorPriceCard from "@/components/activities/SponsorPriceCard";
import TabletPriceCard from "@/components/activities/TabletPriceCard";
import WhiteRicePanel from "@/components/universal-salvation/WhiteRicePanel";
import FixedItemPriceCard from "@/components/activities/FixedItemPriceCard";
import ActivitySettingsCard from "@/components/activities/ActivitySettingsCard";
import { resolvePocketUnitPrice } from "@/lib/pocketPricing";
import { REGISTRATION_ITEM_SEED } from "@/lib/registrationItems";
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
      name: true,
      status: true,
      isArchived: true,
      isCompleted: true,
      pocketUnitPrice: true,
      sponsorUnitPrice: true,
      ancestorUnitPrice: true,
      zhenghunUnitPrice: true,
      yuanqinUnitPrice: true,
      wuyuanUnitPrice: true,
    },
  });

  // V18：這個活動底下的報名項目（總名單逐項連結用）。以 REGISTRATION_ITEM_SEED 的
  // activityGroup 對應主活動類型（UNIVERSAL_SALVATION／ANNUAL_LANTERN／TEMPLE_CELEBRATION／
  // STORAGE_REPAYMENT），不靠活動名稱硬寫死；靜態種子，不需查資料庫。
  const flowItems = eventPricing
    ? REGISTRATION_ITEM_SEED.filter((s) => s.activityGroup === eventPricing.activityType).map((s) => ({ key: s.key, name: s.name }))
    : [];
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
          <BackButton fallbackHref="/activities" />
          <h1 className="text-sm text-ink-soft">{home.name}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        {/* V18：活動整合導覽——所有活動類型都串接報名／收款／列印／總名單（含匯入，普渡），
            取代原本只有普渡才有的硬寫死列印／匯入連結。封存／完成活動仍顯示（查詢用途）。 */}
        {eventPricing && (
          <ActivityFlowHub
            templeEventId={id}
            year={eventPricing.year}
            activityType={eventPricing.activityType}
            activityName={eventPricing.name}
            status={eventPricing.status}
            isArchived={eventPricing.isArchived}
            isCompleted={eventPricing.isCompleted}
            items={flowItems}
          />
        )}

        {/* 活動設定（受理日期／開放）——所有活動通用,建立後可隨時改,不動報名資料。 */}
        {eventPricing && <ActivitySettingsCard templeEventId={id} />}

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
          </>
        )}

        {/* 補庫：固定單價設定（贊普型，一人一份 × 單價；單價存項目本身，不動資料庫）。 */}
        {eventPricing?.activityType === "STORAGE_REPAYMENT" && (
          <FixedItemPriceCard
            itemKey="STORAGE_TROUSERS"
            title="補庫單價"
            note={`民國 ${eventPricing.year} 年度補庫。報名時以此單價 × 份數（一人一份）計算應收。`}
          />
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
