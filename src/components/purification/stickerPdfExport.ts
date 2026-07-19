// 小人頭貼紙 PDF 匯出，跟 src/components/ritual/pdfExport.ts 同樣的做法：
// 把畫面上「所見即所印」的每一張 A4 版面（.sticker-print-sheet）拍成圖片，
// 依序放進 PDF 的每一頁，畫面上看到什麼，PDF 就長什麼樣子。
import { STICKER_SHEET_CLASS } from "./stickerSheetLayout";

export async function exportStickerSheetsToPdf(container: HTMLElement, fileName: string): Promise<void> {
  const [{ jsPDF }, { default: html2canvas }] = await Promise.all([
    import("jspdf"),
    import("html2canvas"),
  ]);

  const sheets = Array.from(container.querySelectorAll<HTMLElement>(`.${STICKER_SHEET_CLASS}`));
  if (sheets.length === 0) {
    throw new Error("目前沒有可匯出的小人頭貼紙版面。");
  }

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });

  for (let i = 0; i < sheets.length; i++) {
    const canvas = await html2canvas(sheets[i], {
      scale: 2,
      backgroundColor: "#ffffff",
      useCORS: true,
    });
    const imgData = canvas.toDataURL("image/png");
    if (i > 0) doc.addPage("a4", "portrait");
    doc.addImage(imgData, "PNG", 0, 0, 210, 297);
  }

  doc.save(fileName);
}
