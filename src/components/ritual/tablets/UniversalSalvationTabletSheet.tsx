import type { CSSProperties } from "react";
import { TABLET_FONT_FAMILY, formatWorkNumber, toPrintableTablet, type PrintTabletEntry } from "./shared";
import { resolveYangshangNames } from "@/lib/yangshang";
import { addressVerticalAlign, verticalTextInnerStyle } from "./addressLayout";
import { fitVerticalFont, fontConfigFor, type TabletFontBox } from "./fontFit";
import {
  A4,
  TABLET_A4_CONFIG,
  buildAutoTabletLayout,
  validateLayout,
  type TabletDocumentType,
  type TabletA4Offset,
  type PositionedBlock,
  type TabletLayout,
  ZERO_OFFSET,
} from "./universalSalvationTabletA4";
import { buildLandscapeTabletLayout, type LandscapeDensity } from "./landscapeLayout";

/** V33：五種牌位（含寶袋）全部共用同一橫式 A4 直書群組引擎——單一 Single Source of Truth。
 *  寶袋僅安全區尺寸/主文（指定名稱）不同，版面規則相同（群組、右→左、頂端對齊、4mm 安全間距）。 */
const LANDSCAPE_DOC_TYPES: TabletDocumentType[] = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD", "POCKET"];

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

/** V32 §4 模板可調樣式（未提供＝既有預設）。 */
export type TabletTemplateStyle = {
  fontFamily?: string | null;
  fontWeight?: string | null;
  letterSpacingPx?: number | null;
  lineHeight?: number | null;
  showCalibrationBox?: boolean; // 顯示校正框（區塊外框，螢幕預覽用）
  showCropMarks?: boolean; // 顯示裁切線
  defaultMainText?: string | null; // 模板預設主文（單筆 printMainText 已於上游優先套用）
};

function VerticalText({
  text,
  sizePx,
  soft,
  align = "center",
  style,
}: {
  text: string;
  sizePx: number;
  soft?: boolean;
  /** V30.5/V33：直式文字沿 inline（垂直）軸的對齊。end＝底部（地址兩行）；start＝頂端（橫式地址/陽上人）。 */
  align?: "center" | "end" | "start";
  /** V32 §4 模板樣式覆寫。 */
  style?: TabletTemplateStyle;
}) {
  if (!text) return null;
  // 未指定模板字型時維持既有 TABLET_FONT_FAMILY；指定則覆寫。
  const inner = verticalTextInnerStyle(align, sizePx, !!soft, style);
  return (
    <div style={{ width: "100%", height: "100%", display: "flex", justifyContent: "center" }}>
      <div style={{ fontFamily: TABLET_FONT_FAMILY, ...inner }}>
        {text}
      </div>
    </div>
  );
}

/**
 * V31 自動字級：依文字量與該區塊 Bounding Box 逐級縮放（各盒獨立設定）。
 * 主文（祖先／乙位／無緣）共用 FONT_CONFIG.main（單一來源、基準 40px、短字不放大、長字才縮）；
 * 寶袋主文用 pocketMain；地址／陽上各自設定。回 { px, overflow }（放不下回最小字級 + overflow 警告，不裁字）。
 */
function fontFitFor(block: PositionedBlock, documentType: TabletDocumentType, lineHeight?: number | null): { px: number; overflow: boolean } {
  const box: TabletFontBox =
    block.blockType === "address"
      ? "address"
      : block.blockType === "yangshang"
        ? "yangshang"
        : documentType === "POCKET"
          ? "pocketMain"
          : "main";
  const r = fitVerticalFont(block.text.length, block.widthMm, block.heightMm, fontConfigFor(box), lineHeight ? { lineHeight } : undefined);
  return { px: r.px, overflow: r.overflow };
}

function BlockView({ block, mode, documentType, style }: { block: PositionedBlock; mode: TabletSheetMode; documentType: TabletDocumentType; style?: TabletTemplateStyle }) {
  // V33 橫式版：版面引擎已算好 fontPx（最大化）→ 直接採用，確保預覽＝正式列印同字級；
  // 其餘（寶袋直式）沿用 fontFitFor 逐級縮放。
  const fit = block.fontPx != null ? { px: block.fontPx, overflow: !!block.overflow } : fontFitFor(block, documentType, style?.lineHeight ?? null);
  // 校正模式或模板「顯示校正框」→ 畫區塊外框（螢幕預覽用；正式列印無框）。
  const showBox = mode === "calibration" || !!style?.showCalibrationBox;
  return (
    <div
      style={{
        position: "absolute",
        left: mm(block.xMm),
        top: mm(block.yMm),
        width: mm(block.widthMm),
        height: mm(block.heightMm),
        boxSizing: "border-box",
        // 校正模式或模板校正框才畫外框；正式列印/PDF 無框線。
        border: showBox ? "0.3mm solid #c0392b" : "none",
        overflow: "hidden",
      }}
      // 綁定值放 data-*（配對用，不列印成內容）。
      data-record-index={block.recordIndex}
      data-slot-index={block.slotIndex}
      data-block-type={block.blockType}
      data-entry-id={block.entryId ?? ""}
      data-registration-id={block.registrationId ?? ""}
    >
      <VerticalText
        text={block.text}
        sizePx={fit.px}
        soft={block.blockType !== "main"}
        // V33：橫式版由 vAlign 指定（主文置中、地址/陽上人靠上＝start）；未指定沿用 V30.5 地址兩行底部對齊規則。
        align={block.vAlign ? block.vAlign : block.blockType === "address" ? addressVerticalAlign(block.text.length, block.heightMm, fit.px) : "center"}
        // V33 陽上人縮字：以區塊自帶 lineHeight/letterSpacingPx 收緊（只作用該區塊），其餘沿用模板樣式。
        style={{
          ...(style ?? {}),
          ...(block.lineHeight != null ? { lineHeight: block.lineHeight } : {}),
          ...(block.letterSpacingPx != null ? { letterSpacingPx: block.letterSpacingPx } : {}),
        }}
      />
      {mode === "calibration" && (
        <div
          style={{ position: "absolute", top: 0, left: 0, fontSize: 8, color: "#c0392b", background: "rgba(255,255,255,.7)", padding: "0 1px", writingMode: "horizontal-tb" }}
        >
          #{block.recordIndex}·slot{block.slotIndex}·{block.blockType}·{block.widthMm}×{block.heightMm}·{fit.px}px
        </div>
      )}
      {/* V33：連最小字級＋最緊字距/行距仍放不下 → 顯示「需人工調整」（不裁字、不跨欄）；操作人需先處理再列印。 */}
      {fit.overflow && (
        <div
          style={{ position: "absolute", bottom: 0, right: 0, fontSize: 7, color: "#fff", background: "#c0392b", padding: "0 1px", writingMode: "horizontal-tb" }}
          data-overflow="1"
          data-needs-manual={block.blockType === "yangshang" ? "1" : undefined}
        >
          {block.blockType === "yangshang" ? "陽上人需人工調整" : "字overflow"}
        </div>
      )}
    </div>
  );
}

/** V32 §4 四角裁切線（L 形，落在 3mm 安全邊界內側，不侵入內容）。 */
function CropMarks() {
  const L = 6; // mm
  const m = TABLET_A4_CONFIG.marginLeftMm;
  const corner = (style: CSSProperties) => (
    <div style={{ position: "absolute", ...style }} />
  );
  const line = { background: "#999" } as const;
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
      {/* 左上 */}
      {corner({ left: mm(m), top: mm(m), width: mm(L), height: "0.2mm", ...line })}
      {corner({ left: mm(m), top: mm(m), width: "0.2mm", height: mm(L), ...line })}
      {/* 右上 */}
      {corner({ right: mm(m), top: mm(m), width: mm(L), height: "0.2mm", ...line })}
      {corner({ right: mm(m), top: mm(m), width: "0.2mm", height: mm(L), ...line })}
      {/* 左下 */}
      {corner({ left: mm(m), bottom: mm(m), width: mm(L), height: "0.2mm", ...line })}
      {corner({ left: mm(m), bottom: mm(m), width: "0.2mm", height: mm(L), ...line })}
      {/* 右下 */}
      {corner({ right: mm(m), bottom: mm(m), width: mm(L), height: "0.2mm", ...line })}
      {corner({ right: mm(m), bottom: mm(m), width: "0.2mm", height: mm(L), ...line })}
    </div>
  );
}

export default function UniversalSalvationTabletSheet({
  documentType,
  records,
  offset = ZERO_OFFSET,
  mode = "print",
  showWorkNumber = true,
  maximize = false,
  template,
  density,
}: {
  documentType: TabletDocumentType;
  records: PrintTabletEntry[];
  offset?: TabletA4Offset;
  mode?: TabletSheetMode;
  /** V30.3：是否顯示裁切外作業號碼 No.<workNumber>（預設顯示；workno=0 時關閉）。 */
  showWorkNumber?: boolean;
  /** V32 §3：是否啟用「高於既有版型」的最高密度排版（預設 false＝保護既有版型；packing 一律計算並顯示）。 */
  maximize?: boolean;
  /** V32 §4 模板可調樣式（字型／字重／字距／行距／校正框／裁切線／預設主文）。未提供＝既有預設。 */
  template?: TabletTemplateStyle;
  /** V33 橫式密度：standard＝附件一密度；economy＝省紙。僅四種牌位橫式版型套用。 */
  density?: LandscapeDensity;
}) {
  const useLandscape = LANDSCAPE_DOC_TYPES.includes(documentType);
  // 統一把 records 轉為版面輸入（含陽上人姓名陣列供 §4 排版切換）。
  const layoutRecords = records.map((e) => {
    const p = toPrintableTablet(e);
    return {
      entryId: null,
      registrationId: null,
      addressText: p.locationText,
      // V32 §4：主文空白時採模板預設主文（單筆 printMainText 已於上游優先套用於 p.displayName）。
      mainText: p.displayName || (template?.defaultMainText ?? ""),
      yangshangText: p.yangshangText,
      yangshangNames: resolveYangshangNames(e.yangshangNames ?? null, e.yangshangName),
    };
  });
  // V33：四種牌位＝橫式 A4 直書（附件一）；寶袋維持既有直式（V32 packing）。
  const layout: TabletLayout = useLandscape
    ? buildLandscapeTabletLayout(documentType, layoutRecords, { density, offset })
    : buildAutoTabletLayout(documentType, layoutRecords, offset, { maximize });
  // 橫式引擎自帶 violations（以橫式頁面尺寸計算）；直式用 validateLayout。
  const violations = layout.violations ?? validateLayout(layout);
  const packing = layout.packing;
  const pageWmm = layout.pageWidthMm ?? A4.widthMm;
  const pageHmm = layout.pageHeightMm ?? A4.heightMm;

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
            width: mm(pageWmm),
            height: mm(pageHmm),
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
                {packing && (
                  <>
                    ｜排版{packing.source === "packed" ? "最高密度" : "固定槽位"}
                    ｜{packing.columns || "-"}欄×{packing.rows || "-"}列={packing.perPage}／基準{packing.baseline}
                    ｜最小字級{Math.round(packing.minFontPx)}px
                    {packing.warnings.length > 0 && `｜⚠️${packing.warnings.join(",")}`}
                    {packing.fallbackReason && `｜${packing.fallbackReason}`}
                  </>
                )}
              </div>
            </>
          )}
          {/* V32 §4 裁切線（四角 L 形標記；模板開啟時顯示，協助對裁）。 */}
          {template?.showCropMarks && <CropMarks />}
          {page.blocks.map((b, i) => (
            <BlockView key={`${b.recordIndex}-${b.blockType}-${i}`} block={b} mode={mode} documentType={documentType} style={template} />
          ))}
          {/* V30.3 作業號碼 No.<workNumber>：位於每筆牌位「區塊外框左上、往上白邊」，
              座標由該筆 slot 的 block 外框計算（非 viewport 固定），裁切後正式成品看不到。
              workNumber 為 null 不顯示；showWorkNumber=false 完全不渲染（不留占位）。 */}
          {showWorkNumber &&
            renderWorkNumbers(page.blocks, records, mode)}
        </div>
      ))}
    </div>
  );
}

/** 依 slot block 外框計算每筆的左上角錨點，於其上方白邊列印 No.<workNumber>。 */
function renderWorkNumbers(
  blocks: PositionedBlock[],
  records: PrintTabletEntry[],
  mode: TabletSheetMode
) {
  // 每筆（recordIndex）取其所有 block 的最小 x/y＝該牌位外框左上角。
  const anchor = new Map<number, { x: number; y: number }>();
  for (const b of blocks) {
    const a = anchor.get(b.recordIndex);
    if (!a) anchor.set(b.recordIndex, { x: b.xMm, y: b.yMm });
    else {
      a.x = Math.min(a.x, b.xMm);
      a.y = Math.min(a.y, b.yMm);
    }
  }
  return [...anchor.entries()].map(([ri, a]) => {
    const wn = records[ri]?.workNumber;
    const label = formatWorkNumber(wn);
    if (label == null) return null; // 未補號不顯示，不印 No.000
    return (
      <div
        key={`workno-${ri}`}
        data-workno={wn}
        style={{
          position: "absolute",
          // 錨在該牌位外框左上，往上 4mm 白邊；夾在頁內（不超出頁面上緣）。
          left: mm(a.x),
          top: mm(Math.max(0.3, a.y - 4)),
          writingMode: "horizontal-tb",
          fontSize: 8,
          lineHeight: 1,
          color: mode === "calibration" ? "#c0392b" : "#000",
          fontFamily: "sans-serif",
          whiteSpace: "nowrap",
          pointerEvents: "none",
        }}
      >
        {label}
      </div>
    );
  });
}
