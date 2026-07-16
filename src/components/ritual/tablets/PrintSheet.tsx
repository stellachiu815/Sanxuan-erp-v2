import type { ComponentType } from "react";
import { A4_PAGE, TABLET_PAGE_LAYOUTS, type PrintTabletEntry, type TabletPageLayoutKey } from "./shared";

type Props = {
  layoutKey: TabletPageLayoutKey;
  entries: PrintTabletEntry[];
  Tablet: ComponentType<{ entry: PrintTabletEntry }>;
  categoryLabel: string;
  sheetIndexInCategory: number;
  sheetCountInCategory: number;
};

/**
 * 一張實體 A4 紙的版面（V4.1 新增）。
 *
 * 依選擇的張數版型（8／12／16 張）把牌位排成固定欄列的格線，畫面上看到
 * 的樣子就是實際會印出來（或匯出 PDF）的樣子。這支元件只負責排版格線，
 * 每一張牌位實際長怎樣由 tablets/index.ts 對應的模板元件決定——之後套用
 * 正式牌位設計時，只需要改模板檔案本身，這支排版元件不用動。
 *
 * className「print-sheet」是 PDF 匯出（見 PrintCenter.tsx 的
 * handleDownloadPdf）尋找每一頁的依據，請勿更改。
 */
export default function PrintSheet({
  layoutKey,
  entries,
  Tablet,
  categoryLabel,
  sheetIndexInCategory,
  sheetCountInCategory,
}: Props) {
  const layout = TABLET_PAGE_LAYOUTS[layoutKey];

  return (
    <div
      className="print-sheet relative mx-auto bg-white"
      style={{
        width: `${A4_PAGE.widthMm}mm`,
        minHeight: `${A4_PAGE.heightMm}mm`,
        padding: `${A4_PAGE.marginMm}mm`,
        boxSizing: "border-box",
        breakAfter: "page",
      }}
    >
      <p className="mb-3 text-xs tracking-widest text-ink-faint">
        — {categoryLabel }・{layout.label}（第 {sheetIndexInCategory} / {sheetCountInCategory} 頁） —
      </p>
      <div
        className="grid gap-4"
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, 1fr)`,
          gridTemplateRows: `repeat(${layout.rows}, 1fr)`,
          height: `calc(${A4_PAGE.heightMm}mm - ${A4_PAGE.marginMm * 2}mm - 1.5rem)`,
        }}
      >
        {entries.map((entry, index) => (
          <Tablet key={index} entry={entry} />
        ))}
      </div>
    </div>
  );
}
