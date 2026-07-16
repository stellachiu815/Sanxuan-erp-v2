import { notFound } from "next/navigation";
import Link from "next/link";
import { getPurificationYearOverview } from "@/lib/purification";
import PurificationYearScreen from "@/components/purification/PurificationYearScreen";

export default async function PurificationYearPage({
  params,
}: {
  params: Promise<{ yearId: string }>;
}) {
  const { yearId } = await params;
  const overview = await getPurificationYearOverview(yearId);

  if (!overview) {
    // 說明同 household/[id]/page.tsx：多這行 throw 讓 TS 自己就能證明
    // 往下走 overview 一定非 null，不依賴 next/navigation 的型別宣告。
    notFound();
    throw new Error("purification year overview not found");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/purification" className="text-sm text-ink-soft hover:underline">
            ← 祭改年度清單
          </Link>
          <h1 className="text-sm text-ink-soft">{overview.name}</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <PurificationYearScreen
          purificationYearId={yearId}
          initialOverview={JSON.parse(JSON.stringify(overview))}
        />
      </main>
    </div>
  );
}
