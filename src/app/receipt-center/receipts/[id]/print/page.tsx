import { notFound } from "next/navigation";
import { getReceiptDetail } from "@/lib/receipt";
import ReceiptPrintView from "@/components/receipt/ReceiptPrintView";

/**
 * 需求「八、收據版型」「九、收據列印」正式收據版型頁面。
 *
 * 比照專案既有列印頁慣例（見 src/app/purification/[yearId]/print/page.tsx、
 * src/components/ritual/PrintCenter.tsx）：用瀏覽器原生 `window.print()`
 * 產生實體列印或「另存為 PDF」，不使用伺服器端 PDF 函式庫——這樣完全依賴
 * 瀏覽器本身的中文字型渲染，不會有伺服器端字型嵌入失敗、亂碼的風險，
 * Mac／Windows 都能正常運作。「下載PDF」按鈕則重用 V4.1 已經建立的
 * html2canvas＋jsPDF 「畫面截圖轉PDF」機制（src/components/ritual/pdfExport.ts），
 * 同樣是「畫面上看到什麼，PDF 就長什麼樣子」，不是另外用字型嵌入的方式
 * 產生 PDF，兩種列印/PDF 路徑都不會遇到中文字型問題。
 */
export default async function ReceiptPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const receipt = await getReceiptDetail(id);
  if (!receipt) notFound();
  if (!receipt.receiptNumber) notFound();

  const latestPrint = receipt.printLogs[0]; // printLogs 已經依 printedAt desc 排序

  return (
    <ReceiptPrintView
      receipt={{
        receiptNumber: receipt.receiptNumber,
        receiptDate: receipt.receiptDate.toISOString(),
        payerName: receipt.payerName,
        totalAmount: Number(receipt.totalAmount),
        lines: receipt.lines.map((l) => ({ itemName: l.itemName, amount: Number(l.amount) })),
        methodType: receipt.paymentTransaction.methodType,
        collectedByName: receipt.paymentTransaction.collectedByName,
        note: receipt.note,
        isReprint: latestPrint?.kind === "REPRINT",
      }}
    />
  );
}
