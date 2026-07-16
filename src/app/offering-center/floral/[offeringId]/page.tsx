import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { listFloralOfferingRoster } from "@/lib/offeringClaims";
import { formatFloralSlotDate } from "@/lib/offeringRules";
import { offeringPaymentStatusLabel, activityTypeLabel } from "@/lib/labels";
import FloralRosterScreen from "@/components/offering/FloralRosterScreen";

/**
 * V10.1「供品認捐中心」需求「十二、花果供品年度名單」畫面的頁面外層。
 *
 * 從 ActivityOfferingsPanel 裡「查看花果供品名單 →」連結進來，一次看到
 * 這個活動、這個供品種類全年 24 次的認捐狀況（沿用 floral-roster API
 * 同一份 listFloralOfferingRoster 資料來源，避免兩套邏輯）。
 */
export default async function FloralRosterPage({ params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;

  const offering = await prisma.activityOffering.findUnique({
    where: { id: offeringId },
    include: { offeringType: true, templeEvent: true },
  });
  if (!offering) notFound();

  const roster = await listFloralOfferingRoster(offeringId);
  const rows = roster.map(({ slot, claim }) => ({
    floralSlotId: slot.id,
    lunarDate: formatFloralSlotDate(slot.lunarMonth, slot.lunarDay),
    sponsorName: claim?.sponsorNameSnapshot ?? "（尚未認捐）",
    amount: claim ? Number(claim.unitPrice ?? 0) * claim.quantity : null,
    paymentStatus: claim ? offeringPaymentStatusLabel[claim.paymentStatus] ?? claim.paymentStatus : null,
    receiptNumbers: claim ? claim.payments.map((p) => p.receiptNumber).filter(Boolean).join("、") : "",
    note: claim?.note ?? slot.note ?? "",
    isActive: slot.isActive,
  }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href={`/offering-center/activity/${offering.templeEventId}`} className="text-sm text-ink-soft hover:underline">
            ← {offering.templeEvent.year} 年 {activityTypeLabel[offering.templeEvent.activityType] ?? offering.templeEvent.activityType}
          </Link>
          <h1 className="text-sm text-ink-soft">🌸 {offering.offeringType.name}年度名單</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <h2 className="text-lg font-medium text-ink print:block hidden">
          {offering.templeEvent.year} 年 {activityTypeLabel[offering.templeEvent.activityType] ?? offering.templeEvent.activityType}
          {offering.offeringType.name}年度名單
        </h2>
        <FloralRosterScreen templeEventId={offering.templeEventId} activityOfferingId={offeringId} initialRoster={rows} />
      </main>
    </div>
  );
}
