// PDF 匯出（V4.1 新增）。
//
// 直接把畫面上「所見即所印」的每一張 A4 版面（.print-sheet）拍成圖片，
// 依序放進 PDF 的每一頁——不是重新排版，畫面上看到什麼，PDF 就長什麼
// 樣子，跟按「列印」看到的結果一致。
//
// jsPDF / html2canvas 都是純瀏覽器端函式庫，這裡用動態 import，確保不會
// 被引入到伺服器端的程式碼路徑（這支檔案只會被 "use client" 的
// PrintCenter.tsx 呼叫）。
export async function exportSheetsToPdf(container: HTMLElement, fileName: string): Promise<void> {
  // jsPDF 從 v2 起官方建議的匯入方式是具名匯出 { jsPDF }，不是 default export。
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const sheets = Array.from(container.querySelectorAll<HTMLElement>(".print-sheet"));
  if (sheets.length === 0) {
    throw new Error("目前沒有可匯出的牌位版面。");
  }

  // V40：頁面尺寸依每張版面「實際比例」自動決定，寬固定 210mm、高照比例算——
  //   感謝狀（210×148 A5 橫式）就出 A5 橫式一頁、牌位（A4）仍出 A4，不再硬塞 A4 造成
  //   下半空白、比例被拉伸。
  let doc: import("jspdf").jsPDF | null = null;
  for (let i = 0; i < sheets.length; i++) {
    const canvas = await html2canvas(sheets[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    const imgData = canvas.toDataURL("image/png");
    const pageW = 210;
    const pageH = Math.max(1, Math.round((pageW * canvas.height) / canvas.width));
    if (!doc) {
      doc = new jsPDF({ unit: "mm", format: [pageW, pageH] });
    } else {
      doc.addPage([pageW, pageH]);
    }
    doc.addImage(imgData, "PNG", 0, 0, pageW, pageH);
  }

  doc?.save(fileName);
}
