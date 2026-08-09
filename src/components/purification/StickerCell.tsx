import type { PurificationPrintFieldsJson } from "./types";
import { STICKER_A4_PAGE } from "./stickerSheetLayout";
import { TABLET_FONT_FAMILY } from "@/components/ritual/tablets/shared";

type Props = {
  fields: PurificationPrintFieldsJson | null;
};

/**
 * 單一格小人頭正式排版。
 *
 * ── 方向（Stella 定案，對照舊版實體）───────────────────────
 * 貼紙在 A4 上是「躺著」的（每格 7cm 寬 × 2.7cm 高，3欄×11列），但實際是**轉 90 度直立貼**。
 * 因此內容排在一個「直立框（2.7cm 寬 × 7cm 高）」裡：三欄直書、由右到左——
 *   最右欄：編號（**直式**，與姓名同向，不再橫式嵌字）＋姓名；
 *   中間欄：歲數＋農曆生日＋吉時建生／瑞生；
 *   最左欄：地址，完整直式。
 * 再用 transform: rotate 讓這個直立框塞進「躺著」的貼紙格；撕下來轉正貼上即為正確直式。
 *
 * 字體大小／字距來自 fields.layout（見 src/lib/purificationLayout.ts）——依字數自動分級縮放，
 * 這支元件不做字級判斷，只套用算好的結果。
 */

const INNER_W_MM = STICKER_A4_PAGE.cellHeightMm; // 27：直立框寬（＝躺著格的高）
const INNER_H_MM = STICKER_A4_PAGE.cellWidthMm; // 70：直立框高（＝躺著格的寬）

export default function StickerCell({ fields }: Props) {
  if (!fields) {
    return <div className="sticker-cell sticker-cell--empty" />;
  }

  const { cellContent, layout, readiness } = fields;
  const hasIssue = !readiness.canPrint;

  return (
    <div
      className={`sticker-cell${hasIssue ? " sticker-cell--issue" : ""}`}
      style={{ position: "relative", fontFamily: TABLET_FONT_FAMILY }}
      title={hasIssue ? readiness.issues.join("；") : undefined}
    >
      {/* 直立框（2.7×7cm），轉 90 度塞進躺著的貼紙格 */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: `${INNER_W_MM}mm`,
          height: `${INNER_H_MM}mm`,
          transform: "translate(-50%, -50%) rotate(90deg)",
          transformOrigin: "center",
          display: "flex",
          flexDirection: "row-reverse",
          alignItems: "stretch",
          justifyContent: "space-between",
          padding: "1.5mm",
          boxSizing: "border-box",
        }}
      >
        {/* 最右欄：編號（直式）＋姓名 */}
        <div
          className="flex h-full flex-col items-center justify-start"
          style={{
            writingMode: "vertical-rl",
            textOrientation: "upright",
            fontSize: `${layout.name.chosenTier.fontSizePt}pt`,
            letterSpacing: `${layout.name.chosenTier.letterSpacingPt}pt`,
          }}
        >
          <span>{cellContent.numberText}</span>
          <span>{cellContent.nameText}</span>
        </div>

        {/* 中間欄：歲數／農曆生日／吉時建生瑞生 */}
        <div
          className="flex h-full flex-col items-center justify-start"
          style={{
            writingMode: "vertical-rl",
            textOrientation: "upright",
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
            textOrientation: "upright",
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
