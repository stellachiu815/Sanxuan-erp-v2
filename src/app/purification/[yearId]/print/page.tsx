import { notFound } from "next/navigation";
import Link from "next/link";
import { getPurificationYearOverview, listPrintBatches } from "@/lib/purification";
import PurificationPrintCenter from "@/components/purification/PurificationPrintCenter";

export default async function PurificationPrintPage({
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

  const batches = await listPrintBatches(yearId);

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur print:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href={`/purification/${yearId}`} className="text-sm text-ink-soft hover:underline">
            ← {overview.name}
          </Link>
          <h1 className="text-sm text-ink-soft">小人頭貼紙列印中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <PurificationPrintCenter
          purificationYearId={yearId}
          yearName={overview.name}
          initialBatches={batches.map((b) => ({
            id: b.id,
            registrationCount: b.registrationCount,
            printedByName: b.printedByName,
            note: b.note,
            createdAt: b.createdAt.toISOString(),
          }))}
        />
      </main>
    </div>
  );
}
