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
// 三欄等寬（編號+姓名併一欄後，三欄平均分配整個寬度）。
const NAME_W = BOX_W / 3;
const MID_W = BOX_W / 3;
const ADDR_W = BOX_W / 3;

/**
 * 每欄＝**單一直行、撐滿整個高度**（不折行），字級 = min(依高度填滿, 欄寬上限)。
 * 這樣又窄又長的貼紙每欄都填滿 7cm 高、字最大；字多的地址欄自然較小（實體限制）。
 */
function maxFont(text: string, colWmm: number, maxPx: number): number {
  const n = Math.max(1, text.length);
  const byHeight = Math.floor((BOX_H * 3.78) / (n * 1.06)); // 單行填滿整欄高
  const byWidth = Math.floor(colWmm * 3.78 * 0.96); // 不超出欄寬
  return Math.max(9, Math.min(maxPx, byHeight, byWidth));
}

/**
 * 三欄直書內容（直立方向＝貼上後的樣子，由右到左）：
 *   最右：編號（直式）＋姓名；中間：歲數＋農曆生日＋吉時建生／瑞生；最左：地址。
 * 字級用 fitVerticalFont 依字數在各欄固定框內**撐到最大**（不用偏小的固定級距）。
 */
function StickerContent({ cellContent }: { cellContent: PurificationPrintFieldsJson["cellContent"]; layout: PurificationPrintFieldsJson["layout"] }) {
  const nameChars = (cellContent.numberText?.length ?? 0) + (cellContent.nameText?.length ?? 0);
  const nameFont = maxFont("x".repeat(nameChars), NAME_W, 40);
  const midFont = maxFont(cellContent.middleText ?? "", MID_W, 40);
  const addrFont = maxFont(cellContent.addressText ?? "", ADDR_W, 40);
  const V = { writingMode: "vertical-rl" as const, textOrientation: "upright" as const, lineHeight: 1.05 };
  return (
    <div className="sticker-content flex h-full w-full flex-row-reverse items-stretch justify-center" style={{ padding: `${PAD_MM}mm`, boxSizing: "border-box", gap: "0.5mm", background: "#fff" }}>
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
