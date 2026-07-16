import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { activityTypeLabel } from "@/lib/labels";
import { listActivityOfferings } from "@/lib/activityOfferings";
import { listOfferingTypes, seedDefaultOfferingTypes } from "@/lib/offeringTypes";
import { listStoveMasterRegistrations } from "@/lib/stoveMasters";
import ActivityOfferingsPanel from "@/components/offering/ActivityOfferingsPanel";
import StoveMasterPanel from "@/components/offering/StoveMasterPanel";
import type { ActivityOfferingJSON, OfferingTypeJSON } from "@/components/offering/types";

const STOVE_MASTER_ACTIVITY_TYPES = new Set([
  "TEMPLE_CELEBRATION",
  "GUANDI_BIRTHDAY",
  "XUANTIAN_BIRTHDAY",
  "YAOCHI_BIRTHDAY",
  "ZHONGTAN_BIRTHDAY",
]);

export default async function OfferingActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.templeEvent.findUnique({ where: { id } });
  if (!event) notFound();

  await seedDefaultOfferingTypes();

  const [offerings, allTypes, stoveMasters] = await Promise.all([
    listActivityOfferings(id),
    listOfferingTypes(true),
    STOVE_MASTER_ACTIVITY_TYPES.has(event.activityType) ? listStoveMasterRegistrations(id) : Promise.resolve([]),
  ]);

  const initialOfferings: ActivityOfferingJSON[] = offerings.map((o) => ({
    id: o.id,
    templeEventId: o.templeEventId,
    offeringTypeId: o.offeringTypeId,
    offeringType: {
      id: o.offeringType.id,
      name: o.offeringType.name,
      category: o.offeringType.category,
      behaviorKind: o.offeringType.behaviorKind,
      unit: o.offeringType.unit,
      isChargeable: o.offeringType.isChargeable,
      hasLimitedQuantity: o.offeringType.hasLimitedQuantity,
      defaultQuantity: o.offeringType.defaultQuantity,
      defaultPrice: o.offeringType.defaultPrice ? o.offeringType.defaultPrice.toString() : null,
      allowPriceOverride: o.offeringType.allowPriceOverride,
      allowDuplicateClaim: o.offeringType.allowDuplicateClaim,
      claimMode: o.offeringType.claimMode,
      isActive: o.offeringType.isActive,
      sortOrder: o.offeringType.sortOrder,
      note: o.offeringType.note,
    },
    quantity: o.quantity,
    price: o.price ? o.price.toString() : null,
    useDefaultPrice: o.useDefaultPrice,
    allowPriceOverride: o.allowPriceOverride,
    hasLimitedQuantity: o.hasLimitedQuantity,
    isChargeable: o.isChargeable,
    claimMode: o.claimMode,
    claimStartDate: o.claimStartDate ? o.claimStartDate.toISOString() : null,
    claimEndDate: o.claimEndDate ? o.claimEndDate.toISOString() : null,
    status: o.status,
    note: o.note,
  }));

  const initialTypes: OfferingTypeJSON[] = allTypes.map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category,
    behaviorKind: t.behaviorKind,
    unit: t.unit,
    isChargeable: t.isChargeable,
    hasLimitedQuantity: t.hasLimitedQuantity,
    defaultQuantity: t.defaultQuantity,
    defaultPrice: t.defaultPrice ? t.defaultPrice.toString() : null,
    allowPriceOverride: t.allowPriceOverride,
    allowDuplicateClaim: t.allowDuplicateClaim,
    claimMode: t.claimMode,
    isActive: t.isActive,
    sortOrder: t.sortOrder,
    note: t.note,
  }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <Link href="/offering-center" className="text-sm text-ink-soft hover:underline">
            ← 供品認捐中心
          </Link>
          <h1 className="text-sm text-ink-soft">
            {event.year} 年 {activityTypeLabel[event.activityType] ?? event.activityType}
          </h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-8 px-6 py-10">
        <section className="rounded-3xl bg-white/70 p-8 shadow-card">
          <h2 className="text-lg font-medium text-ink">供品設定與認捐</h2>
          <p className="mt-1 text-sm text-ink-faint">
            從供品種類庫加入這個活動需要的供品，各活動彼此獨立設定，互不影響。
          </p>
          <div className="mt-5">
            <ActivityOfferingsPanel templeEventId={id} initialOfferings={initialOfferings} allOfferingTypes={initialTypes} />
          </div>
        </section>

        {STOVE_MASTER_ACTIVITY_TYPES.has(event.activityType) && (
          <section className="rounded-3xl bg-white/70 p-8 shadow-card">
            <h2 className="text-lg font-medium text-ink">爐主與副爐主</h2>
            <p className="mt-1 text-sm text-ink-faint">不屬供品、不收費，只登錄最後結果。</p>
            <div className="mt-5">
              <StoveMasterPanel templeEventId={id} initialRegistrations={stoveMasters} />
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
