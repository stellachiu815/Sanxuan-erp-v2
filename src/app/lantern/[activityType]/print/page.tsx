import { notFound } from "next/navigation";
import BackButton from "@/components/navigation/BackButton";
import Link from "next/link";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";
import LanternPrintCenterWithOperator from "@/components/ritual/LanternPrintCenterWithOperator";
import { LANTERN_ACTIVITY_TYPES, LANTERN_TYPE_LABEL } from "@/lib/lanternPrint";
import { listActivityYearCandidates, pickDefaultActivityYear } from "@/lib/activityYear";
import type { ActivityType } from "@prisma/client";

/**
 * 年度燈燈牌／疏文 mm 正式列印頁。
 *
 * 網址：/lantern/GUANGMING_LANTERN/print（可帶 ?year=116 由列印中心指定年度）
 *
 * ── V39 修正（第二批） ──────────────────────────────────────
 *  1. 年度解析改用 **ANNUAL_LANTERN**：三種燈（光明／太歲／全家）都掛在單一
 *     年度燈事件底下，舊頁用子類型（FAMILY_LANTERN…）去查活動年度永遠查不到，
 *     於是一直顯示「尚未建立…活動」——這就是列印中心以外那個孤島頁的死結。
 *  2. 加上操作人員選擇器（OperatorBar）＋改由 useOperator() 取得操作人員，
 *     不再靠網址帶 operatorUserId 而卡在「請先於右上角選擇操作人員」。
 *  3. 可由列印中心的年度燈入口以 ?year= 指定年度直接進來（普渡當年／年度燈隔年）。
 *
 * 虛歲、生肖、太歲、建生瑞生一律由「活動使用年度」決定（見 lanternPrint.ts），
 * 民國 115 年印 116 年度時歲數自動＋1，與電腦今天日期無關。
 */
export const dynamic = "force-dynamic";

export default async function LanternPrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ activityType: string }>;
  searchParams: Promise<{ year?: string }>;
}) {
  const { activityType } = await params;
  const { year: yearParam } = await searchParams;

  if (!LANTERN_ACTIVITY_TYPES.includes(activityType as ActivityType)) {
    notFound();
  }

  const label = LANTERN_TYPE_LABEL[activityType] ?? activityType;

  // V39：一律以承載年度燈的單一 ANNUAL_LANTERN 事件解析年度（修子類型查無的 bug）。
  const candidates = await listActivityYearCandidates("ANNUAL_LANTERN");
  const now = new Date();
  const decision = pickDefaultActivityYear(candidates, now, now.getFullYear() - 1911);

  const availableYears = candidates.map((c) => c.year).sort((a, b) => b - a);
  const urlYear = yearParam ? Number(yearParam) : NaN;
  // 沒有任何已建立的活動時，不偷偷生一個年度出來——顯示提示請先建立活動。
  const defaultYear =
    Number.isInteger(urlYear) && availableYears.includes(urlYear)
      ? urlYear
      : decision.ok
        ? decision.candidate.year
        : (availableYears[0] ?? 0);

  return (
    <OperatorProvider>
      <div className="min-h-screen">
        <OperatorBar />
        <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-5xl items-center gap-4">
            <BackButton
              fallbackHref="/print-center"
              className="whitespace-nowrap text-sm text-ink-soft transition hover:text-ink"
            />
            <span className="truncate text-sm text-ink-faint">{label}列印</span>
          </div>
        </header>

        <main className="mx-auto max-w-5xl px-6 py-10 print:max-w-none print:p-0">
          {availableYears.length === 0 ? (
            <div className="rounded-3xl border border-cream-200 bg-white p-6 print:hidden">
              <h1 className="mb-2 text-lg font-medium text-ink">尚未建立年度燈活動</h1>
              <p className="text-sm text-ink-soft">
                請先於活動中心建立年度燈的活動年度（包含開始受理、截止受理與活動日期），
                建立後才能列印{label}。系統不會自動建立不存在的活動年度。
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
              <h1 className="mb-6 text-xl font-medium text-ink print:hidden">{label}列印管理</h1>
              <LanternPrintCenterWithOperator
                activityType={activityType}
                activityTypeLabel={label}
                availableYears={availableYears}
                defaultYear={defaultYear}
              />
            </>
          )}
        </main>
      </div>
    </OperatorProvider>
  );
}
