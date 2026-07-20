import { notFound } from "next/navigation";
import Link from "next/link";
import LanternPrintCenter from "@/components/ritual/LanternPrintCenter";
import { LANTERN_ACTIVITY_TYPES, LANTERN_TYPE_LABEL } from "@/lib/lanternPrint";
import { listActivityYearCandidates, pickDefaultActivityYear } from "@/lib/activityYear";
import type { ActivityType } from "@prisma/client";

/**
 * V13.1 指令十一：年度燈列印頁。
 *
 * 網址：/lantern/GUANGMING_LANTERN/print
 *
 * ⚠️ 預設年度由 activityYear 的**共用判斷機制**決定（依活動是否開放報名、
 * 是否完成、截止日），**不是今年**。民國 115 年底開啟這個頁面，若 116
 * 年度的活動已經建立並開放，預設就會是 116 年度。
 */
export const dynamic = "force-dynamic";

export default async function LanternPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ activityType: string }>;
  searchParams: Promise<{ operatorUserId?: string }>;
}) {
  const { activityType } = await params;
  const { operatorUserId } = await searchParams;

  if (!LANTERN_ACTIVITY_TYPES.includes(activityType as ActivityType)) {
    notFound();
  }

  const label = LANTERN_TYPE_LABEL[activityType] ?? activityType;

  const candidates = await listActivityYearCandidates(activityType as ActivityType);
  const now = new Date();
  const decision = pickDefaultActivityYear(candidates, now, now.getFullYear() - 1911);

  const availableYears = candidates.map((c) => c.year).sort((a, b) => b - a);
  // 沒有任何已建立的活動時，不偷偷生一個年度出來——顯示提示請先建立活動
  const defaultYear = decision.ok ? decision.candidate.year : (availableYears[0] ?? 0);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link
            href="/activities"
            className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
          >
            ← 返回活動中心
          </Link>
          <span className="truncate text-sm text-ink-faint">{label}列印</span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 print:max-w-none print:p-0">
        {availableYears.length === 0 ? (
          <div className="rounded-3xl border border-cream-200 bg-white p-6 print:hidden">
            <h1 className="mb-2 text-lg font-medium text-ink">尚未建立{label}活動</h1>
            <p className="text-sm text-ink-soft">
              請先於活動中心建立{label}的活動年度（包含開始受理、截止受理與活動日期），
              建立後才能進行列印。系統不會自動建立不存在的活動年度。
            </p>
            <Link
              href="/activities"
              className="mt-4 inline-flex min-h-11 items-center rounded-2xl bg-yolk-200 px-5 text-sm font-medium text-ink transition hover:bg-yolk-300"
            >
              前往活動中心建立
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-6 text-xl font-medium text-ink print:hidden">{label}列印中心</h1>
            <LanternPrintCenter
              activityType={activityType}
              activityTypeLabel={label}
              availableYears={availableYears}
              defaultYear={defaultYear}
              operatorUserId={operatorUserId ?? null}
            />
          </>
        )}
      </main>
    </div>
  );
}
