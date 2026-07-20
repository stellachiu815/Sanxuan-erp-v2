import Link from "next/link";
import { getCollectionHomeSummary } from "@/lib/collectionCenter";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * 這一頁在「每次請求」時即時查詢資料庫，不做建置期預渲染。
 *
 * 原因（V12.3 建置修正）：App Router 的頁面預設是靜態的——只要沒有用到
 * cookies()／headers()／searchParams 這類動態 API，Next.js 就會在
 * `next build` 階段直接執行這個 Server Component 並把結果存成靜態 HTML。
 * 本頁的資料來自直接呼叫 Prisma（不是 fetch，所以也沒有 fetch 層的快取
 * 標記可以讓 Next.js 判斷「這是動態資料」），因此會發生兩個問題：
 *
 *   1. 建置階段會去連線正式資料庫。資料庫在建置當下不可達（例如在本機
 *      build、或 Render 資料庫短暫離線）就會直接 build 失敗（Prisma P1001）。
 *   2. 更嚴重的是就算建置成功，這一頁也會被凍結成建置當下的快照，
 *      之後行政人員看到的數字不會更新，要等下一次部署才會變。
 *
 * 這一頁顯示的是即時營運資料，本來就不該被快取，所以明確標記為動態渲染。
 *
 * ⚠️ 這不會吞掉執行期的資料庫錯誤：請求當下若連不上資料庫，仍會照常拋出
 * 錯誤並顯示錯誤畫面，只是不再於建置階段連線。
 */
export const dynamic = "force-dynamic";

/**
 * V11.0「全宮共用收款中心」主選單。
 *
 * 需求列出的 8 個分頁，這裡依實際好用的方式整合成 5 條主要路徑（比照
 * V10.1 供品認捐中心的畫面整合慣例，詳見交付報告的畫面整合說明）：
 * 1. 待收款項 → /collection-center/pending
 * 2. 快速收款（含購物籃合併收款、其他臨時應收項目建立）→ /collection-center/quick-payment
 * 3. 收款紀錄（含退款/轉款/作廢，點進單筆收款詳細頁操作）→ /collection-center/payments
 * 4. 代收管理／代收對帳（合併成同一個分頁的兩個區塊）→ /collection-center/agent-collection
 * 5. 月結收款報表 → /collection-center/monthly-report
 * 收據中心（V11.1）、財務中心正式串接本輪都不做，這裡不會出現對應連結。
 */
export default async function CollectionCenterHomePage() {
  const year = getCurrentRitualYear();
  const summary = await getCollectionHomeSummary(year);

  const tiles = [
    { href: "/collection-center/pending", label: "📋 待收款項", desc: `${summary.pendingReceivableCount} 筆待收`, color: "bg-blossom-100 hover:bg-blossom-200" },
    { href: "/collection-center/quick-payment", label: "⚡ 快速收款", desc: "搜尋信眾、合併結帳", color: "bg-sage-100 hover:bg-sage-200" },
    { href: "/collection-center/payments", label: "🧾 收款紀錄", desc: "查詢、退款、轉款、作廢", color: "bg-mist-100 hover:bg-mist-200" },
    { href: "/collection-center/agent-collection", label: "🤝 代收管理／代收對帳", desc: `${summary.agentPendingCount} 筆待對帳`, color: "bg-yolk-100 hover:bg-yolk-200" },
    { href: "/collection-center/monthly-report", label: "📊 月結收款報表", desc: "依月份彙總", color: "bg-cream-200 hover:bg-cream-300" },
  ];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4">
          <Link href="/" className="text-sm text-ink-soft hover:underline">
            ← 三玄宮行政系統
          </Link>
          <h1 className="text-sm text-ink-soft">💰 全宮共用收款中心</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-10">
        <p className="text-sm text-ink-soft">
          {year} 年度・目前共 {summary.pendingReceivableCount} 筆待收款項（{summary.pendingReceivableAmount.toLocaleString("zh-Hant")} 元），
          {summary.crossYearUnpaidCount} 筆跨年度未收款。
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
            ⚠️ 收據中心（V11.1）與正式財務中心尚未串接：這裡的每一筆分配都預留了收據狀態欄位，
            也預留了財務來源識別碼防重複入帳機制，但目前都還沒有真正的收據或財務資料寫入。
          </p>
        </div>
      </main>
    </div>
  );
}
