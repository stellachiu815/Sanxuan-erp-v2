import StickerCell from "./StickerCell";
import { STICKER_A4_PAGE, STICKER_SHEET_CLASS } from "./stickerSheetLayout";
import type { PurificationPrintFieldsJson } from "./types";

type Props = {
  cells: PurificationPrintFieldsJson[]; // 最多 33 筆，不足的格子留空（不會用其他頁的資料頂替）
  pageIndex: number;
  pageCount: number;
};

/**
 * 一張實體 A4 小人頭貼紙版面（需求「八」：固定 3欄×11列＝33格）。
 *
 * 每張固定 33 格，資料不滿 33 筆時，剩下的格子畫成空白格（虛線框），
 * 不會把下一批資料往前遞補、也不會因為這一頁人少就放大格子——對應需求
 * 「十二」：「跳過禁用編號不代表留下空白貼紙格（相鄰排列）」，這裡的
 * 空格只會出現在最後一頁的尾端，不會出現在中間。
 *
 * className「sticker-print-sheet」是 PDF 匯出尋找每一頁的依據，請勿更改
 * （見 stickerPdfExport.ts）。
 */
export default function StickerSheet({ cells, pageIndex, pageCount }: Props) {
  const slots: (PurificationPrintFieldsJson | null)[] = Array.from(
    { length: STICKER_A4_PAGE.perPage },
    (_, i) => cells[i] ?? null
  );

  return (
    <div
      className={`${STICKER_SHEET_CLASS} relative mx-auto bg-white`}
      style={{
        width: `${STICKER_A4_PAGE.widthMm}mm`,
        minHeight: `${STICKER_A4_PAGE.heightMm}mm`,
        padding: `${STICKER_A4_PAGE.marginMm}mm`,
        boxSizing: "border-box",
        breakAfter: "page",
      }}
    >
      <p className="mb-2 text-[9px] tracking-widest text-ink-faint print:hidden">
        — 小人頭貼紙・第 {pageIndex + 1} / {pageCount} 頁（{cells.length} 筆） —
      </p>
      <div
        className="grid"
        style={{
          gridTemplateColumns: `repeat(${STICKER_A4_PAGE.cols}, 1fr)`,
          gridTemplateRows: `repeat(${STICKER_A4_PAGE.rows}, 1fr)`,
          gap: `${STICKER_A4_PAGE.gapMm}mm`,
          height: `calc(${STICKER_A4_PAGE.heightMm}mm - ${STICKER_A4_PAGE.marginMm * 2}mm - 4mm)`,
        }}
      >
        {slots.map((fields, i) => (
          <StickerCell key={i} fields={fields} />
        ))}
      </div>
    </div>
  );
}
