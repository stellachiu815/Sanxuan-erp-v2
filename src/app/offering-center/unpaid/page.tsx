import Link from "next/link";
import { listOfferingClaims } from "@/lib/offeringClaims";
import { getCurrentRitualYear } from "@/lib/ritual";
import UnpaidListScreen from "@/components/offering/UnpaidListScreen";

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
