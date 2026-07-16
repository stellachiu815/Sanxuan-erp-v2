import Link from "next/link";
import { listPendingReceivables } from "@/lib/collectionCenter";
import { getCurrentRitualYear } from "@/lib/ritual";
import PendingReceivablesScreen from "@/components/collection/PendingReceivablesScreen";

export default async function CollectionPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ onlyCrossYear?: string }>;
}) {
  const { onlyCrossYear } = await searchParams;
  const currentYear = getCurrentRitualYear();
  const initialOnlyCrossYear = onlyCrossYear === "1";
  const rows = await listPendingReceivables({ currentYear, onlyCrossYear: initialOnlyCrossYear });
  const initialRows = rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <Link href="/collection-center" className="text-sm text-ink-soft hover:underline">
            ← 收款中心
          </Link>
          <h1 className="text-sm text-ink-soft">📋 待收款項</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-5xl flex-col gap-6 px-6 py-10">
        <PendingReceivablesScreen
          initialRows={initialRows}
          currentYear={currentYear}
          initialOnlyCrossYear={initialOnlyCrossYear}
        />
      </main>
    </div>
  );
}
