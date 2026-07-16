import type { PurificationPrintFieldsJson } from "./types";

type Props = {
  fields: PurificationPrintFieldsJson | null;
};

/**
 * 單一格小人頭正式直式排版（需求「九」）。
 *
 * 三欄直書，閱讀順序由右至左：
 * - 最右欄：編號（阿拉伯數字橫排，用 text-combine-upright 嵌在直式欄位裡，
 *   不會被拆開）＋姓名（直式）。
 * - 中間欄：歲數＋農曆生日＋吉時建生/瑞生，全部直式。
 * - 最左欄：地址，完整直式排列，不截斷。
 *
 * 用 flex-direction: row-reverse 達成「畫面看起來由右到左」，DOM 順序仍然
 * 是「姓名欄 → 中間欄 → 地址欄」（由右到左的閱讀順序），不需要用
 * row-reverse 以外的技巧就能做到視覺上的直式右到左版面。
 *
 * 字體大小／字距完全來自 fields.layout 三欄各自的最佳化結果（見
 * src/lib/purificationLayout.ts），這支元件本身不做任何字級判斷，只負責
 * 套用已經算好的數字——這樣「智慧最佳化」的邏輯只存在一個地方，畫面跟
 * PDF 看到的、後端判斷「是否可以列印」用的，是同一份計算結果。
 */
export default function StickerCell({ fields }: Props) {
  if (!fields) {
    return <div className="sticker-cell sticker-cell--empty" />;
  }

  const { cellContent, layout, readiness } = fields;
  const hasIssue = !readiness.canPrint;

  return (
    <div className={`sticker-cell${hasIssue ? " sticker-cell--issue" : ""}`} title={hasIssue ? readiness.issues.join("；") : undefined}>
      <div className="flex h-full w-full flex-row-reverse items-stretch justify-between">
        {/* 最右欄：編號＋姓名 */}
        <div
          className="flex h-full flex-col items-center justify-start"
          style={{
            writingMode: "vertical-rl",
            fontSize: `${layout.name.chosenTier.fontSizePt}pt`,
            letterSpacing: `${layout.name.chosenTier.letterSpacingPt}pt`,
          }}
        >
          <span
            style={{ textCombineUpright: "all" as never, fontSize: "0.6em" }}
            className="inline-block"
          >
            {cellContent.numberText}
          </span>
          <span>{cellContent.nameText}</span>
        </div>

        {/* 中間欄：歲數／農曆生日／吉時建生瑞生 */}
        <div
          className="flex h-full flex-col items-center justify-start"
          style={{
            writingMode: "vertical-rl",
            fontSize: `${layout.middle.chosenTier.fontSizePt}pt`,
            letterSpacing: `${layout.middle.chosenTier.letterSpacingPt}pt`,
          }}
        >
          {cellContent.middleText}
        </div>

        {/* 最左欄：地址 */}
        <div
          className="flex h-full flex-col items-center justify-start"
          style={{
            writingMode: "vertical-rl",
            fontSize: `${layout.address.chosenTier.fontSizePt}pt`,
            letterSpacing: `${layout.address.chosenTier.letterSpacingPt}pt`,
          }}
        >
          {cellContent.addressText}
        </div>
      </div>
    </div>
  );
}
