import Link from "next/link";
import QuickPaymentScreen from "@/components/collection/QuickPaymentScreen";
import { getCurrentRitualYear } from "@/lib/ritual";

export default function QuickPaymentPage() {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/collection-center" className="text-sm text-ink-soft hover:underline">
            ← 收款中心
          </Link>
          <h1 className="text-sm text-ink-soft">⚡ 快速收款</h1>
        </div>
      </header>
      <main className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-10">
        <QuickPaymentScreen currentYear={getCurrentRitualYear()} />
      </main>
    </div>
  );
}
