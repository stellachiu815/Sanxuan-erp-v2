import Link from "next/link";
import { listOfferingTypes, seedDefaultOfferingTypes } from "@/lib/offeringTypes";
import OfferingTypeSettingsScreen from "@/components/offering/OfferingTypeSettingsScreen";
import type { OfferingTypeJSON } from "@/components/offering/types";

export default async function OfferingTypeSettingsPage() {
  // 需求「一」：系統首次啟用時建立預設 5 種供品，已存在同名資料就跳過
  // （見 seedDefaultOfferingTypes 說明），之後管理者可以自由修改/停用。
  await seedDefaultOfferingTypes();
  const types = await listOfferingTypes(true);
  const initialTypes: OfferingTypeJSON[] = types.map((t) => ({
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
          <h1 className="text-sm text-ink-soft">⚙️ 供品種類設定</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
        <OfferingTypeSettingsScreen initialTypes={initialTypes} />
      </main>
    </div>
  );
}
