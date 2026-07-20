import Link from "next/link";
import { listReceipts } from "@/lib/receipt";
import ReceiptListScreen from "@/components/receipt/ReceiptListScreen";
import { OperatorProvider } from "@/lib/operatorClient";
import OperatorBar from "@/components/system/OperatorBar";

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

export default async function ReceiptListPage() {
  const receipts = await listReceipts();

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-cream-200 bg-cream-50/90 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <Link href="/receipt-center" className="text-sm text-ink-soft hover:underline">
            ← 收據中心
          </Link>
          <h1 className="text-sm text-ink-soft">🧾 已開立收據／收據查詢</h1>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-10">
        <OperatorProvider>
          <OperatorBar />
          <ReceiptListScreen
            initialRows={receipts.map((r) => ({
              id: r.id,
              receiptNumber: r.receiptNumber,
              receiptDate: r.receiptDate.toISOString(),
              payerName: r.payerName,
              totalAmount: Number(r.totalAmount),
              status: r.status,
              printCount: r.printCount,
              reprintCount: r.printLogs.filter((p) => p.kind === "REPRINT").length,
              transactionNo: r.paymentTransaction.transactionNo,
              itemSummary: r.lines.map((l) => l.itemName).join("、"),
              createdByName: r.createdByName,
            }))}
          />
        </OperatorProvider>
      </main>
    </div>
  );
}
