import type { HouseholdActivitySettlement } from "@/lib/householdActivitySettlement";

/**
 * 家戶頁「本次活動結算」卡片（唯讀、伺服器端渲染）。
 *
 * 放在家戶標題卡片正下方最顯眼處：信眾一問「我家這次多少錢」，一眼看完。
 * 資料全來自真實報名（見 householdActivitySettlement.ts），字級刻意放大，
 * 方便長輩／老花閱讀。純顯示，不做任何寫入。
 */

function money(n: number) {
  return n.toLocaleString("zh-Hant");
}

export default function CurrentActivitySettlementCard({
  settlements,
}: {
  settlements: HouseholdActivitySettlement[];
}) {
  const grandDue = settlements.reduce((s, a) => s + a.totalDue, 0);
  const grandPaid = settlements.reduce((s, a) => s + a.totalPaid, 0);
  const grandUnpaid = settlements.reduce((s, a) => s + a.totalUnpaid, 0);

  return (
    <section className="rounded-3xl bg-yolk-50 p-8 shadow-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-xl font-medium text-ink">本次活動結算</h2>
        <span className="text-xs text-ink-faint">信眾詢問「我家多少錢」即時查看・撈實際報名金額</span>
      </div>

      {settlements.length === 0 ? (
        <p className="mt-5 text-base text-ink-soft">本戶目前沒有進行中的活動報名。</p>
      ) : (
        <>
          {/* 合計——最顯眼，直接回答「多少錢」 */}
          <div className="mt-5 rounded-2xl bg-white/80 px-6 py-5 shadow-soft">
            <p className="text-sm text-ink-soft">本戶本次應繳合計</p>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-6 gap-y-1">
              <span className="text-4xl font-semibold text-ink">{money(grandDue)} 元</span>
              <span className="text-lg text-sage-300">已收 {money(grandPaid)} 元</span>
              <span className="text-lg text-blossom-500">未收 {money(grandUnpaid)} 元</span>
            </div>
          </div>

          {/* 各活動明細 */}
          <div className="mt-5 flex flex-col gap-4">
            {settlements.map((a) => (
              <div key={a.ritualRecordId} className="rounded-2xl bg-white/70 px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-medium text-ink">{a.activityGroupName}</span>
                  <span className="text-sm text-ink-faint">民國 {a.year} 年度</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      a.status === "DRAFT" ? "bg-yolk-100 text-ink-soft" : "bg-sage-100 text-ink-soft"
                    }`}
                  >
                    {a.status === "DRAFT" ? "草稿（未確認）" : a.status === "CONFIRMED" ? "已確認" : a.status}
                  </span>
                  <a
                    href={`/registration/${a.ritualRecordId}`}
                    className="ml-auto text-xs text-blossom-500 underline-offset-4 hover:underline"
                  >
                    看／改報名內容 →
                  </a>
                </div>

                <ul className="mt-3 flex flex-col gap-1.5">
                  {a.lines.map((ln, i) => (
                    <li key={i} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 text-base">
                      <span className="text-ink">
                        {ln.registrantName && <span className="mr-2 text-sm text-ink-faint">{ln.registrantName}</span>}
                        {ln.displayLabel}
                        <span className="ml-2 text-sm text-ink-soft">
                          ×{ln.quantity}
                          {ln.contentKind === "RICE" ? " 斤" : ""}
                          {ln.unitPrice != null ? `（單價 ${money(ln.unitPrice)} 元）` : ""}
                        </span>
                      </span>
                      <span className="text-ink">
                        {money(ln.amountDue)} 元
                        {ln.amountUnpaid > 0 && ln.amountUnpaid !== ln.amountDue && (
                          <span className="ml-2 text-sm text-blossom-500">未收 {money(ln.amountUnpaid)}</span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-cream-200 pt-2 text-sm">
                  <span className="text-ink">小計應收：{money(a.totalDue)} 元</span>
                  <span className="text-sage-300">已收：{money(a.totalPaid)} 元</span>
                  <span className="text-blossom-500">未收：{money(a.totalUnpaid)} 元</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
