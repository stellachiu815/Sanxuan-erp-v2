// 小人頭貼紙 PDF 匯出。
//
// 重點：html2canvas「不吃 CSS transform 旋轉」，所以不能整張版面直接拍
// （會變成內容沒轉、擠在格子頂端）。改成：
//   1. 逐格把「直立內容（.sticker-content，未旋轉）」拍成圖片；
//   2. 用 canvas「真的旋轉 90 度」（不是 CSS，是像素層級旋轉）；
//   3. 放進 PDF 對應的格子位置（躺著的 7×2.7cm）。
// 這樣 PDF 就會跟畫面上的「實際預覽」一模一樣。
import { STICKER_SHEET_CLASS, STICKER_A4_PAGE } from "./stickerSheetLayout";

const COLS = STICKER_A4_PAGE.cols; // 3
const ROWS = STICKER_A4_PAGE.rows; // 11
const PAGE_W = STICKER_A4_PAGE.widthMm; // 210
const PAGE_H = STICKER_A4_PAGE.heightMm; // 297
const CELL_W = PAGE_W / COLS; // 70mm（躺著的格寬）
const CELL_H = PAGE_H / ROWS; // 27mm（躺著的格高）

/** 把一張直立內容 canvas 旋轉 90 度，回傳新的（躺著的）canvas。 */
function rotate90(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.height; // 轉後寬 = 原高
  out.height = src.width; // 轉後高 = 原寬
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate(Math.PI / 2); // 順時針 90 度，與畫面 rotate(90deg) 一致
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

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

  for (let s = 0; s < sheets.length; s++) {
    if (s > 0) doc.addPage("a4", "portrait");

    // 這張 A4 的所有格子（含空格），依序取得位置。
    const cells = Array.from(sheets[s].querySelectorAll<HTMLElement>(".sticker-cell"));
    for (let i = 0; i < cells.length; i++) {
      const content = cells[i].querySelector<HTMLElement>(".sticker-content");
      if (!content) continue; // 空格不畫

      // 拍「直立內容」（未旋轉），高解析度。
      const shot = await html2canvas(content, {
        scale: 3,
        backgroundColor: "#ffffff",
        useCORS: true,
      });
      const rotated = rotate90(shot);
      const imgData = rotated.toDataURL("image/png");

      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL_W;
      const y = row * CELL_H;
      doc.addImage(imgData, "PNG", x, y, CELL_W, CELL_H);
    }
  }

  doc.save(fileName);
}
