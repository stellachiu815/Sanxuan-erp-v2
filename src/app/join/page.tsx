import Link from "next/link";
import { listOpenPublicForms } from "@/lib/publicReg";
import { activityTypeLabel } from "@/lib/labels";

/**
 * 信眾公開報名入口頁 /join（免登入）。
 * 列出目前開放中的線上報名活動（補庫／宮燈／年度燈／普渡等），信眾點進去即可自己報名。
 * 只顯示「表單已開啟且活動在受理期間內」的活動；沒有開放中的就顯示提示。
 */
export const dynamic = "force-dynamic";

export default async function PublicJoinIndexPage() {
  const forms = await listOpenPublicForms();

  return (
    <main className="mx-auto max-w-xl px-4 py-10">
      <header className="text-center">
        <h1 className="text-xl text-ink">台北三玄宮・線上報名</h1>
        <p className="mt-2 text-sm text-ink-soft">請選擇要報名的活動。送出後由廟方核對成立，不會馬上收款。</p>
      </header>

      {forms.length === 0 ? (
        <div className="mt-8 rounded-2xl bg-white/70 p-6 text-center text-sm text-ink-soft shadow-card">
          目前沒有開放中的線上報名。請稍後再來，或直接洽詢廟方。
        </div>
      ) : (
        <ul className="mt-8 flex flex-col gap-3">
          {forms.map((f) => (
            <li key={f.slug}>
              <Link
                href={`/join/${encodeURIComponent(f.slug)}`}
                className="flex items-center justify-between rounded-2xl bg-white/80 px-5 py-4 shadow-card transition hover:bg-cream-50"
              >
                <span className="flex flex-col">
                  <span className="text-base font-medium text-ink">{f.activityName}</span>
                  <span className="text-xs text-ink-faint">
                    {activityTypeLabel[f.activityType] ?? ""}{f.year ? `・民國 ${f.year} 年度` : ""}
                  </span>
                </span>
                <span className="text-sm font-semibold text-emerald-600">前往報名 →</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
