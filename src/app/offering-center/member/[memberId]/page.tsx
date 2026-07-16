import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getMemberOfferingHistory } from "@/lib/offeringClaims";
import { formatFloralSlotDate } from "@/lib/offeringRules";
import {
  activityTypeLabel,
  offeringPaymentStatusLabel,
  offeringClaimStatusLabel,
} from "@/lib/labels";

/**
 * V10.1「供品認捐中心」需求「十八、歷年查詢」：從信眾資料頁進來，查看
 * 這位信眾歷年所有供品認捐紀錄。金額一律讀認捐當時存下的快照
 * （unitPrice/amountDue），不會因為之後供品種類或活動設定調整價格而
 * 跟著變動，符合「歷史價格不受影響」的要求。
 */
export default async function MemberOfferingHistoryPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;

  const member = await prisma.member.findUnique({
    where: { id: memberId },
    include: { household: true },
  });
  if (!member) notFound();

  const claims = await getMemberOfferingHistory(memberId);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href={`/household/${member.householdId}`} className="text-sm text-ink-soft hover:underline">
            ← {member.household.name}
          </Link>
          <h1 className="text-sm text-ink-soft">📜 {member.name} 供品認捐歷年查詢</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <h2 className="text-lg font-medium text-ink print:block hidden">{member.name} 供品認捐歷年查詢</h2>

        {claims.length === 0 && (
          <p className="text-sm text-ink-faint">這位信眾目前沒有供品認捐紀錄。</p>
        )}

        {claims.length > 0 && (
          <div className="overflow-x-auto rounded-2xl bg-white/70 shadow-card">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-cream-200 text-xs text-ink-faint">
                  <th className="px-4 py-3">年度</th>
                  <th className="px-4 py-3">活動</th>
                  <th className="px-4 py-3">供品</th>
                  <th className="px-4 py-3">日期／數量</th>
                  <th className="px-4 py-3">應收</th>
                  <th className="px-4 py-3">已收</th>
                  <th className="px-4 py-3">未收</th>
                  <th className="px-4 py-3">收款狀態</th>
                  <th className="px-4 py-3">認捐狀態</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c) => (
                  <tr key={c.id} className="border-b border-cream-100">
                    <td className="px-4 py-3">{c.year}</td>
                    <td className="px-4 py-3">{activityTypeLabel[c.activity.activityType] ?? c.activity.activityType}</td>
                    <td className="px-4 py-3">{c.offeringType.name}</td>
                    <td className="px-4 py-3">
                      {c.floralSlot ? formatFloralSlotDate(c.floralSlot.lunarMonth, c.floralSlot.lunarDay) : `${c.quantity} ${c.offeringType.name}`}
                    </td>
                    <td className="px-4 py-3">{Number(c.amountDue).toLocaleString("zh-Hant")}</td>
                    <td className="px-4 py-3">{Number(c.amountPaid).toLocaleString("zh-Hant")}</td>
                    <td className="px-4 py-3">{Number(c.amountUnpaid).toLocaleString("zh-Hant")}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-cream-100 px-2 py-0.5 text-xs text-ink-soft">
                        {offeringPaymentStatusLabel[c.paymentStatus] ?? c.paymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-mist-100 px-2 py-0.5 text-xs text-ink-soft">
                        {offeringClaimStatusLabel[c.status] ?? c.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
