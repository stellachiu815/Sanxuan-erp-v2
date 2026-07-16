import Link from "next/link";
import { listOfferingClaims } from "@/lib/offeringClaims";
import { getCurrentRitualYear } from "@/lib/ritual";
import UnpaidListScreen from "@/components/offering/UnpaidListScreen";

export default async function OfferingUnpaidPage({
  searchParams,
}: {
  searchParams: Promise<{ crossYear?: string }>;
}) {
  const currentYear = getCurrentRitualYear();
  const { crossYear } = await searchParams;
  const initialCrossYearOnly = crossYear === "1";
  const claims = await listOfferingClaims(
    initialCrossYearOnly
      ? { onlyUnpaid: true, onlyCrossYearUnpaid: true, currentYear }
      : { onlyUnpaid: true }
  );

  const initialClaims = claims.map((c) => ({
    id: c.id,
    activityId: c.activityId,
    activityOfferingId: c.activityOfferingId,
    offeringTypeId: c.offeringTypeId,
    offeringType: { name: c.offeringType.name },
    floralSlotId: c.floralSlotId,
    year: c.year,
    sponsorMemberId: c.sponsorMemberId,
    sponsorHouseholdId: c.sponsorHouseholdId,
    sponsorNameSnapshot: c.sponsorNameSnapshot,
    phoneSnapshot: c.phoneSnapshot,
    quantity: c.quantity,
    unitPrice: c.unitPrice ? c.unitPrice.toString() : null,
    amountDue: c.amountDue.toString(),
    amountPaid: c.amountPaid.toString(),
    amountUnpaid: c.amountUnpaid.toString(),
    paymentStatus: c.paymentStatus,
    receiptStatus: c.receiptStatus,
    expectedPaymentDate: c.expectedPaymentDate ? c.expectedPaymentDate.toISOString() : null,
    collectionNote: c.collectionNote,
    note: c.note,
    status: c.status,
    createdAt: c.createdAt.toISOString(),
  }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/offering-center" className="text-sm text-ink-soft hover:underline">
            ← 供品認捐中心
          </Link>
          <h1 className="text-sm text-ink-soft">💰 未收款清單</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <UnpaidListScreen
          initialClaims={initialClaims}
          currentYear={currentYear}
          initialOnlyCrossYear={initialCrossYearOnly}
        />
      </main>
    </div>
  );
}
