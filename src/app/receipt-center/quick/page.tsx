import BackButton from "@/components/navigation/BackButton";
import QuickReceiptScreen from "@/components/receipt/QuickReceiptScreen";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * 現場快速開感謝狀 /receipt-center/quick。
 * 填一填（搜人／建新 → 捐獻＋活動繳款 → 現金）→ 直接開立並跳列印。
 */
export const dynamic = "force-dynamic";

export default function QuickReceiptPage() {
  const year = getCurrentRitualYear();
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <BackButton fallbackHref="/" />
          <h1 className="text-sm text-ink-soft">🧾 現場快速開感謝狀</h1>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-8">
        <QuickReceiptScreen year={year} />
      </main>
    </div>
  );
}
