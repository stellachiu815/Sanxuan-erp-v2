import Link from "next/link";
import { getReceiptHomeSummary } from "@/lib/receipt";

/**
 * V11.1「全宮共用收據中心」主選單。
 *
 * 需求列出的 8 個分頁，這裡依實際好用的方式整合成 4 條主要路徑（比照 V11.0
 * 收款中心「8 個需求分頁整合成 5 條實際路徑」的既有慣例，詳見交付報告的
 * 畫面整合說明）：
 * 1. 待開立收據 → /receipt-center/pending（含合併開立/分項開立/標記不需開立）
 * 2. 已開立收據／收據查詢（兩個需求分頁本質是同一份查詢＋列表，合併成一個
 *    頁面，用篩選條件切換）→ /receipt-center/receipts
 *    （收據補印／收據作廢都在點進單張收據詳細頁後操作，比照收款中心
 *    「退款/轉款/作廢都在收款詳細頁操作」的既有慣例，不獨立成分頁）
 * 3. 收據號碼管理／收據設定（合併成一個設定頁）→ /receipt-center/settings
 * 4. 收據統計 → /receipt-center/stats
 */
export default async function ReceiptCenterHomePage() {
  const summary = await getReceiptHomeSummary();

  const tiles = [
    { href: "/receipt-center/pending", label: "📋 待開立收據", desc: `${summary.pendingCount} 筆待開立`, color: "bg-blossom-100 hover:bg-blossom-200" },
    { href: "/receipt-center/receipts", label: "🧾 已開立收據／收據查詢", desc: "查詢、列印、補印、作廢、換開", color: "bg-mist-100 hover:bg-mist-200" },
    { href: "/receipt-center/settings", label: "⚙️ 收據號碼管理／設定", desc: "前綴、年制、位數、重編政策", color: "bg-yolk-100 hover:bg-yolk-200" },
    { href: "/receipt-center/stats", label: "📊 收據統計", desc: "開立/作廢/換開/補印次數統計", color: "bg-cream-200 hover:bg-cream-300" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">🧾 全宮共用收據中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <p className="text-sm text-ink-soft">
          目前共 {summary.pendingCount} 筆待開立收據（{summary.pendingAmount.toLocaleString("zh-Hant")} 元），
          今日已開立 {summary.todayIssuedCount} 張，本月已開立 {summary.monthIssuedCount} 張。
        </p>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className={`rounded-3xl p-6 shadow-card transition ${t.color}`}>
              <p className="text-base text-ink">{t.label}</p>
              <p className="mt-1 text-xs text-ink-faint">{t.desc}</p>
            </Link>
          ))}
        </div>

        <div className="rounded-3xl bg-white/70 p-6 text-xs text-ink-faint shadow-soft">
          <p>
            ⚠️ 收據只能由收款中心的正式收款（PaymentTransaction／PaymentAllocation）產生，不會有任何一條路徑
            繞過收款中心直接由供品認捐、普渡、祭改等原始宮務資料建立收據。正式財務收入來源仍然是收款中心，
            開立/補印/作廢/換開收據都不會影響財務數字。
          </p>
        </div>
      </main>
    </div>
  );
}
