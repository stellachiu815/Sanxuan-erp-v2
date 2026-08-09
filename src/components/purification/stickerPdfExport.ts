// 小人頭貼紙「列印 / 另存 PDF」。
//
// 為什麼不用 html2canvas 截圖：html2canvas 同時無法正確處理
//   (1) CSS transform 旋轉，(2) 直書 writing-mode: vertical-rl + upright，
// 這兩者正是小人頭貼紙的核心（躺著印、內容轉 90 度直立）。所以截圖出來
// 一定歪掉。
//
// 正解：開一個乾淨的列印視窗，把畫面上「你已經確認 OK 的實際預覽版面
// （.sticker-print-sheet）」原封不動搬過去，交給瀏覽器自己用同一套渲染
// 引擎去印——直書、旋轉、標楷體全部 100% 正確。使用者在列印對話框可以
// 直接列印，或選「另存為 PDF」。
import { STICKER_SHEET_CLASS } from "./stickerSheetLayout";

export async function exportStickerSheetsToPdf(container: HTMLElement, fileName: string): Promise<void> {
  const sheets = Array.from(container.querySelectorAll<HTMLElement>(`.${STICKER_SHEET_CLASS}`));
  if (sheets.length === 0) {
    throw new Error("目前沒有可列印的小人頭貼紙版面。");
  }

  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) {
    throw new Error("瀏覽器擋掉了列印視窗，請允許此網站開啟彈出視窗後再試一次。");
  }

  // 把主頁面的所有樣式（Tailwind 等）一起帶過去，版面才會跟畫面一致；
  // 各格的尺寸(mm)、旋轉 transform、字級、字型都是 inline style，會隨
  // outerHTML 一起帶過去。
  const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((n) => n.outerHTML)
    .join("\n");
  const body = sheets.map((s) => s.outerHTML).join("\n");

  w.document.open();
  w.document.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${fileName}</title>${styles}` +
      `<style>` +
      `@page { size: A4 portrait; margin: 0; }` +
      `html, body { margin: 0; padding: 0; background: #fff; }` +
      `.${STICKER_SHEET_CLASS} { margin: 0 !important; box-shadow: none !important; break-after: page; }` +
      `</style></head><body>${body}</body></html>`
  );
  w.document.close();

  // 等樣式／字體套用後再叫出列印對話框。
  const doPrint = () => {
    try {
      w.focus();
      w.print();
    } catch {
      /* 使用者可自行在新視窗按 Cmd+P 列印 */
    }
  };
  if (w.document.readyState === "complete") {
    setTimeout(doPrint, 600);
  } else {
    w.onload = () => setTimeout(doPrint, 600);
  }
}
