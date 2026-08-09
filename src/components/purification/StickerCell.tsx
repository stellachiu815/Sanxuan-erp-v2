import type { PurificationPrintFieldsJson } from "./types";
import { TABLET_FONT_FAMILY } from "@/components/ritual/tablets/shared";
import { fitVerticalFont } from "@/components/ritual/tablets/fontFit";
import { STICKER_A4_PAGE } from "./stickerSheetLayout";

type Props = {
  fields: PurificationPrintFieldsJson | null;
  /** "sheet"＝A4 貼紙格（躺著 7×2.7cm，內容轉 90 度）；"preview"＝放大預覽（直立、貼上後的樣子，不轉）。 */
  orientation?: "sheet" | "preview";
};

// A4 貼紙格實體尺寸：寬 70mm（210/3）、高 ~26.6mm（(297-4)/11，與 StickerSheet grid 一致）。
const CELL_W_MM = STICKER_A4_PAGE.widthMm / STICKER_A4_PAGE.cols;
const CELL_H_MM = (STICKER_A4_PAGE.heightMm - STICKER_A4_PAGE.marginMm * 2 - 4) / STICKER_A4_PAGE.rows;

// 直立內容框＝ 寬 CELL_H_MM（~26.6mm）× 高 CELL_W_MM（70mm）。三欄，姓名欄較寬（字最大）。
const PAD_MM = 0.8;
const BOX_W = CELL_H_MM - PAD_MM * 2; // 三欄可用寬
const BOX_H = CELL_W_MM - PAD_MM * 2; // 欄高（~68mm）
// 欄寬權重（編號+姓名併一欄後，把空間讓給歲數生日與地址，讓它們放大）：
//   姓名欄窄（字少、可放大不需寬）、地址欄最寬（字多，可折成兩直行變大）。
const NAME_W = BOX_W * 0.26;
const MID_W = BOX_W * 0.32;
const ADDR_W = BOX_W * 0.42;

/**
 * 依字數把某欄字級撐到框內最大（同普渡牌位 fitVerticalFont，會自動折成多直行以放大）。
 * capWidth=true（姓名欄，字少）：以欄寬封頂避免單行字超出欄寬；
 * capWidth=false（中間/地址欄，字多）：交給 fitVerticalFont，讓它折行後撐到最大。
 */
function maxFont(text: string, colWmm: number, maxPx: number, capWidth: boolean): number {
  const fit = fitVerticalFont(text.length || 1, colWmm, BOX_H, { maxPx, minPx: 9, stepPx: 1 }, { lineHeight: 1.03, colSpacing: 1.0 }).px;
  if (capWidth) return Math.max(9, Math.min(fit, Math.floor(colWmm * 3.78 * 0.98)));
  return Math.max(9, fit);
}

/**
 * 三欄直書內容（直立方向＝貼上後的樣子，由右到左）：
 *   最右：編號（直式）＋姓名；中間：歲數＋農曆生日＋吉時建生／瑞生；最左：地址。
 * 字級用 fitVerticalFont 依字數在各欄固定框內**撐到最大**（不用偏小的固定級距）。
 */
function StickerContent({ cellContent }: { cellContent: PurificationPrintFieldsJson["cellContent"]; layout: PurificationPrintFieldsJson["layout"] }) {
  const nameChars = (cellContent.numberText?.length ?? 0) + (cellContent.nameText?.length ?? 0);
  const nameFont = maxFont("x".repeat(nameChars), NAME_W, 40, true);
  const midFont = maxFont(cellContent.middleText ?? "", MID_W, 40, false);
  const addrFont = maxFont(cellContent.addressText ?? "", ADDR_W, 40, false);
  const V = { writingMode: "vertical-rl" as const, textOrientation: "upright" as const, lineHeight: 1.05 };
  return (
    <div className="flex h-full w-full flex-row-reverse items-stretch justify-center" style={{ padding: `${PAD_MM}mm`, boxSizing: "border-box", gap: "0.5mm" }}>
      <div className="flex flex-col items-center justify-start" style={{ width: `${NAME_W}mm` }}>
        <span style={{ ...V, fontSize: nameFont, fontWeight: 600 }}>{cellContent.numberText}{cellContent.nameText}</span>
      </div>
      <div className="flex flex-col items-center justify-start" style={{ width: `${MID_W}mm` }}>
        <span style={{ ...V, fontSize: midFont }}>{cellContent.middleText}</span>
      </div>
      <div className="flex flex-col items-center justify-start" style={{ width: `${ADDR_W}mm` }}>
        <span style={{ ...V, fontSize: addrFont }}>{cellContent.addressText}</span>
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
