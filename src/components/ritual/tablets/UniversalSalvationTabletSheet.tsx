import { TABLET_FONT_FAMILY, toPrintableTablet, type PrintTabletEntry } from "./shared";
import {
  A4,
  TABLET_A4_CONFIG,
  buildTabletLayout,
  validateLayout,
  type TabletDocumentType,
  type TabletA4Offset,
  type PositionedBlock,
  ZERO_OFFSET,
} from "./universalSalvationTabletA4";

/**
 * UNIVERSAL_SALVATION_TABLET_A4_V1 的**唯一**渲染元件——四種 documentType 共用。
 * Preview（一般）、校正預覽、PDF、正式列印**都用同一份 buildTabletLayout 結果**。
 *
 * mode:
 *  - "print"       ：正式輸出（Preview／PDF／列印）——只印文字、無任何輔助框線。
 *  - "calibration" ：校正——顯示 A4 邊界、3mm 安全邊界、每塊外框、slotIndex/recordIndex、
 *                    尺寸與 offset。**輔助內容僅在 calibration 出現，不會進入 print/PDF。**
 *
 * offset 超界時：不渲染牌位，改顯示錯誤（呼叫端據此阻擋正式 PDF／列印）。
 */
export type TabletSheetMode = "print" | "calibration";

const mm = (v: number) => `${v}mm`;

function VerticalText({ text, sizePx, soft }: { text: string; sizePx: number; soft?: boolean }) {
  if (!text) return null;
  return (
    <div
      style={{
        writingMode: "vertical-rl",
        textOrientation: "mixed",
        fontSize: sizePx,
        lineHeight: 1.15,
        textAlign: "center",
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: soft ? "#333" : "#000",
        fontFamily: TABLET_FONT_FAMILY,
      }}
    >
      {text}
    </div>
  );
}

/** 依區塊型別給字級（mm→px 粗略換算，1mm≈3.78px；正式版可再由宮方微調）。 */
function fontPxFor(block: PositionedBlock): number {
  if (block.blockType === "main") return 40;
  if (block.blockType === "address") return 16;
  return 20; // yangshang
}

function BlockView({ block, mode }: { block: PositionedBlock; mode: TabletSheetMode }) {
  return (
    <div
      style={{
        position: "absolute",
        left: mm(block.xMm),
        top: mm(block.yMm),
        width: mm(block.widthMm),
        height: mm(block.heightMm),
        boxSizing: "border-box",
        // 校正模式才畫外框；正式列印/PDF 無框線。
        border: mode === "calibration" ? "0.3mm solid #c0392b" : "none",
        overflow: "hidden",
      }}
      // 綁定值放 data-*（配對用，不列印成內容）。
      data-record-index={block.recordIndex}
      data-slot-index={block.slotIndex}
      data-block-type={block.blockType}
      data-entry-id={block.entryId ?? ""}
      data-registration-id={block.registrationId ?? ""}
    >
      <VerticalText text={block.text} sizePx={fontPxFor(block)} soft={block.blockType !== "main"} />
      {mode === "calibration" && (
        <div
          style={{ position: "absolute", top: 0, left: 0, fontSize: 8, color: "#c0392b", background: "rgba(255,255,255,.7)", padding: "0 1px", writingMode: "horizontal-tb" }}
        >
          #{block.recordIndex}·slot{block.slotIndex}·{block.blockType}·{block.widthMm}×{block.heightMm}
        </div>
      )}
    </div>
  );
}

export default function UniversalSalvationTabletSheet({
  documentType,
  records,
  offset = ZERO_OFFSET,
  mode = "print",
}: {
  documentType: TabletDocumentType;
  records: PrintTabletEntry[];
  offset?: TabletA4Offset;
  mode?: TabletSheetMode;
}) {
  const layout = buildTabletLayout(
    documentType,
    records.map((e) => {
      const p = toPrintableTablet(e);
      return {
        entryId: null,
        registrationId: null,
        addressText: p.locationText,
        mainText: p.displayName,
        yangshangText: p.yangshangText,
      };
    }),
    offset
  );
  const violations = validateLayout(layout);

  if (violations.length > 0) {
    // offset/資料使版面超界或衝突 → 阻擋正式輸出，顯示錯誤（呼叫端據此擋 PDF/列印）。
    return (
      <div data-tablet-layout-error="1" style={{ padding: 16, color: "#c0392b", fontFamily: TABLET_FONT_FAMILY }}>
        ⚠️ 版面驗證未通過，已阻擋列印（請調整 X/Y Offset 或內容）：
        <ul>
          {violations.slice(0, 8).map((v, i) => (
            <li key={i}>{v.code}：{v.detail}</li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="tablet-a4-sheets">
      {layout.pages.map((page) => (
        <div
          key={page.pageIndex}
          // print-sheet：沿用既有 PDF 匯出（pdfExport 以 .print-sheet 逐頁擷取）。
          className="print-sheet tablet-a4-page"
          style={{
            position: "relative",
            width: mm(A4.widthMm),
            height: mm(A4.heightMm),
            background: "#fff",
            breakAfter: "page",
            overflow: "hidden",
          }}
        >
          {mode === "calibration" && (
            <>
              {/* A4 外框 */}
              <div style={{ position: "absolute", inset: 0, border: "0.3mm solid #999", pointerEvents: "none" }} />
              {/* 3mm 安全邊界 */}
              <div
                style={{
                  position: "absolute",
                  left: mm(TABLET_A4_CONFIG.marginLeftMm),
                  top: mm(TABLET_A4_CONFIG.marginTopMm),
                  right: mm(TABLET_A4_CONFIG.marginRightMm),
                  bottom: mm(TABLET_A4_CONFIG.marginBottomMm),
                  border: "0.3mm dashed #2980b9",
                  pointerEvents: "none",
                }}
              />
              <div style={{ position: "absolute", right: 2, top: 2, fontSize: 8, color: "#2980b9", writingMode: "horizontal-tb" }}>
                {documentType}｜page {page.pageIndex + 1}｜offset({offset.offsetXmm},{offset.offsetYmm})mm｜每頁{layout.slotsPerPage}筆
              </div>
            </>
          )}
          {page.blocks.map((b, i) => (
            <BlockView key={`${b.recordIndex}-${b.blockType}-${i}`} block={b} mode={mode} />
          ))}
        </div>
      ))}
    </div>
  );
}
