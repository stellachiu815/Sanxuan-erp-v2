import Link from "next/link";
import { getReceiptNumberingConfig, previewNextReceiptNumber } from "@/lib/receipt";
import { previewReceiptNumberFormat } from "@/lib/receiptRules";
import ReceiptSettingsScreen from "@/components/receipt/ReceiptSettingsScreen";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";

export default async function ReceiptSettingsPage() {
  const config = await getReceiptNumberingConfig();
  const preview = previewReceiptNumberFormat(config, new Date());
  const nextNumber = await previewNextReceiptNumber();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
          <Link href="/receipt-center" className="text-sm text-ink-soft hover:underline">
            ← 收據中心
          </Link>
          <h1 className="text-sm text-ink-soft">⚙️ 收據號碼管理／設定</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <ReceiptSettingsScreen
            initialConfig={config}
            initialPreview={preview}
            initialNextNumber={nextNumber}
          />
        </OperatorProvider>
      </main>
    </div>
  );
}
