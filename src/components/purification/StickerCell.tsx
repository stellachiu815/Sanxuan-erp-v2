import type { PurificationPrintFieldsJson } from "./types";
import { TABLET_FONT_FAMILY } from "@/components/ritual/tablets/shared";
import { STICKER_A4_PAGE } from "./stickerSheetLayout";

type Props = {
  fields: PurificationPrintFieldsJson | null;
  /** "sheet"＝A4 貼紙格（躺著 7×2.7cm，內容轉 90 度）；"preview"＝放大預覽（直立、貼上後的樣子，不轉）。 */
  orientation?: "sheet" | "preview";
};

// A4 貼紙格實體尺寸：寬 70mm（210/3）、高 ~26.6mm（(297-4)/11，與 StickerSheet grid 一致）。
const CELL_W_MM = STICKER_A4_PAGE.widthMm / STICKER_A4_PAGE.cols;
const CELL_H_MM = (STICKER_A4_PAGE.heightMm - STICKER_A4_PAGE.marginMm * 2 - 4) / STICKER_A4_PAGE.rows;

/**
 * 三欄直書內容（直立方向＝貼上後的樣子，由右到左）：
 *   最右：編號（直式）＋姓名；中間：歲數＋農曆生日＋吉時建生／瑞生；最左：地址。
 * 字級／字距來自 fields.layout（依字數自動分級縮放）。
 */
function StickerContent({ cellContent, layout }: { cellContent: PurificationPrintFieldsJson["cellContent"]; layout: PurificationPrintFieldsJson["layout"] }) {
  return (
    <div className="flex h-full w-full flex-row-reverse items-stretch justify-between" style={{ padding: "1mm", boxSizing: "border-box" }}>
      <div
        className="flex h-full flex-col items-center justify-start"
        style={{ writingMode: "vertical-rl", textOrientation: "upright", fontSize: `${layout.name.chosenTier.fontSizePt}pt`, letterSpacing: `${layout.name.chosenTier.letterSpacingPt}pt` }}
      >
        <span>{cellContent.numberText}</span>
        <span>{cellContent.nameText}</span>
      </div>
      <div
        className="flex h-full flex-col items-center justify-start"
        style={{ writingMode: "vertical-rl", textOrientation: "upright", fontSize: `${layout.middle.chosenTier.fontSizePt}pt`, letterSpacing: `${layout.middle.chosenTier.letterSpacingPt}pt` }}
      >
        {cellContent.middleText}
      </div>
      <div
        className="flex h-full flex-col items-center justify-start"
        style={{ writingMode: "vertical-rl", textOrientation: "upright", fontSize: `${layout.address.chosenTier.fontSizePt}pt`, letterSpacing: `${layout.address.chosenTier.letterSpacingPt}pt` }}
      >
        {cellContent.addressText}
      </div>
    </div>
  );
}

export default function StickerCell({ fields, orientation = "sheet" }: Props) {
  if (!fields) {
    return <div className="sticker-cell sticker-cell--empty" />;
  }
  const { cellContent, layout, readiness } = fields;
  const hasIssue = !readiness.canPrint;

  // 放大預覽：直立（貼上後的樣子），內容填滿容器、不旋轉。
  if (orientation === "preview") {
    return (
      <div className={`sticker-cell${hasIssue ? " sticker-cell--issue" : ""}`} style={{ fontFamily: TABLET_FONT_FAMILY, width: "100%", height: "100%" }} title={hasIssue ? readiness.issues.join("；") : undefined}>
        <StickerContent cellContent={cellContent} layout={layout} />
      </div>
    );
  }

  // A4 貼紙格：內容排在「直立框（寬＝格高、高＝格寬）」，再轉 90 度塞進躺著的格子。
  return (
    <div
      className={`sticker-cell${hasIssue ? " sticker-cell--issue" : ""}`}
      style={{ position: "relative", overflow: "hidden", fontFamily: TABLET_FONT_FAMILY }}
      title={hasIssue ? readiness.issues.join("；") : undefined}
    >
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: `${CELL_H_MM}mm`,
          height: `${CELL_W_MM}mm`,
          transform: "translate(-50%, -50%) rotate(90deg)",
          transformOrigin: "center center",
        }}
      >
        <StickerContent cellContent={cellContent} layout={layout} />
      </div>
    </div>
  );
}
