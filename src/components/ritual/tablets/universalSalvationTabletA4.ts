/**
 * UNIVERSAL_SALVATION_TABLET_A4_V1
 *
 * 中元普渡四種牌位（歷代祖先／乙位正魂／無緣子女／累世冤親債主）**共用**的 A4 直式
 * 版面引擎——單一引擎、固定槽位、實體 mm 尺寸、集中設定，只依 documentType 切換內容。
 *
 * 規格（已與需求方逐項確認）：
 *  - A4 210×297mm、四周安全邊界 3mm、區塊最小間距 1mm、區塊不旋轉、不縮尺寸。
 *  - 三區塊型（ANCESTOR_LINE/INDIVIDUAL_SOUL/UNBORN_CHILD）每頁固定 5 筆；每筆＝地址＋主文字＋陽上。
 *  - 累世冤親債主（DEBT_CREDITOR）每頁固定 11 筆；每筆＝地址＋陽上（**無主文字，不建立矩形、不佔尺寸**）。
 *  - 正式執行**不做動態裝箱**：座標固定，避免不同資料產生不同排列。
 *  - 分頁：pageIndex=⌊recordIndex/perPage⌋、slotIndex=recordIndex%perPage（recordIndex 0-based）。
 *  - 最後一頁只輸出實際資料、不補空白；同一筆不得跨頁。
 *  - X/Y Offset 整頁一致套用於最終座標，不改寬高/筆數/分頁/間距/recordIndex 對應；套用後需重驗邊界。
 *
 * 寶袋尺寸不同 → 本引擎不含寶袋。
 */

export const TABLET_A4_TEMPLATE_ID = "UNIVERSAL_SALVATION_TABLET_A4_V1" as const;

export type TabletDocumentType = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "UNBORN_CHILD" | "DEBT_CREDITOR" | "POCKET";
export type TabletBlockType = "address" | "main" | "yangshang";

/** A4 紙張與集中設定（邊界/間距/offset 皆集中於此，不散落硬編碼）。 */
export const A4 = { widthMm: 210, heightMm: 297 } as const;

export const TABLET_A4_CONFIG = {
  marginTopMm: 3,
  marginBottomMm: 3,
  marginLeftMm: 3,
  marginRightMm: 3,
  horizontalGapMm: 1,
  verticalGapMm: 1,
} as const;

export type TabletA4Offset = { offsetXmm: number; offsetYmm: number };
export const ZERO_OFFSET: TabletA4Offset = { offsetXmm: 0, offsetYmm: 0 };

/** 安全可用區（扣 3mm 邊界）：x∈[3,207]、y∈[3,294]。 */
export const USABLE = {
  x0: TABLET_A4_CONFIG.marginLeftMm,
  y0: TABLET_A4_CONFIG.marginTopMm,
  x1: A4.widthMm - TABLET_A4_CONFIG.marginRightMm,
  y1: A4.heightMm - TABLET_A4_CONFIG.marginBottomMm,
} as const;

/** 三種區塊的實體 mm 尺寸（累世冤親債主／DEBT_CREDITOR 沿用，不變）。 */
export const BLOCK_SIZE: Record<TabletBlockType, { widthMm: number; heightMm: number }> = {
  address: { widthMm: 15, heightMm: 150 },
  main: { widthMm: 50, heightMm: 100 },
  yangshang: { widthMm: 20, heightMm: 70 },
};

/**
 * V27.12：三區塊型（歷代祖先／乙位正魂／無緣子女）改為「同一筆的 地址·主文·陽上 緊密成組」
 * 的槽位後，為在每頁 5 筆的 2×3 網格內把三塊排在同一格，地址／主文高度由 150／100 微調為 94
 * （寬度不變）。**只作用於三區塊型**；累世冤親債主仍用上方 BLOCK_SIZE（15×150 等），格式不受影響。
 * 主文 94mm 仍可完整直排「蔡府歷代祖先」「歐陽府歷代祖先」等（6～7 字）。
 */
const THREE_BLOCK_SIZE: Record<TabletBlockType, { widthMm: number; heightMm: number }> = {
  address: { widthMm: 15, heightMm: 94 },
  main: { widthMm: 50, heightMm: 94 },
  yangshang: { widthMm: 20, heightMm: 70 },
};

/**
 * V30.3 寶袋（POCKET）實體 mm 尺寸（需求方既定，不得擅改）：
 *   地址 2.5×14cm＝25×140mm、主文 4.5×6cm＝45×60mm、陽上 2.5×6.5cm＝25×65mm。
 * 與四種牌位共用同一 A4 引擎（固定槽位、mm 座標、3mm 邊界、1mm 最小間距、作業號碼定位）。
 */
const POCKET_SIZE: Record<TabletBlockType, { widthMm: number; heightMm: number }> = {
  address: { widthMm: 25, heightMm: 140 },
  main: { widthMm: 45, heightMm: 60 },
  yangshang: { widthMm: 25, heightMm: 65 },
};

/** 取某型別、某區塊的實體尺寸：冤親債主用 BLOCK_SIZE、寶袋用 POCKET_SIZE、其餘三區塊型用 THREE_BLOCK_SIZE。 */
export function blockSizeFor(documentType: TabletDocumentType, blockType: TabletBlockType): { widthMm: number; heightMm: number } {
  if (documentType === "DEBT_CREDITOR") return BLOCK_SIZE[blockType];
  if (documentType === "POCKET") return POCKET_SIZE[blockType];
  return THREE_BLOCK_SIZE[blockType];
}

/** documentType → 該型別包含哪些區塊（順序即渲染順序）。冤親債主無主文字；寶袋三區塊。 */
export const DOCUMENT_BLOCKS: Record<TabletDocumentType, TabletBlockType[]> = {
  ANCESTOR_LINE: ["address", "main", "yangshang"],
  INDIVIDUAL_SOUL: ["address", "main", "yangshang"],
  UNBORN_CHILD: ["address", "main", "yangshang"],
  DEBT_CREDITOR: ["address", "yangshang"],
  POCKET: ["address", "main", "yangshang"],
};

/**
 * 每頁固定筆數。寶袋＝4（依既定尺寸與 3mm 邊界計算：每筆整組寬≈97mm、高 140mm，
 * A4 可用 204×291mm 內排 2 欄×2 列＝4 筆；3 欄需 291mm>204、3 列需 420mm>291，皆不可）。
 */
export const SLOTS_PER_PAGE: Record<TabletDocumentType, number> = {
  ANCESTOR_LINE: 5,
  INDIVIDUAL_SOUL: 5,
  UNBORN_CHILD: 5,
  DEBT_CREDITOR: 11,
  POCKET: 4,
};

type Coord = { x: number; y: number };

/**
 * 三區塊型固定槽位座標（5 槽；第 i 筆對應第 i 個座標）。
 *
 * V27.12：改為「同一筆成組」——每一筆是一格牌位，格內由左至右緊鄰排列
 * 地址(15w)→間距2→主文(50w)→間距2→陽上(20w)，整格寬 89mm、高 94mm。
 * 五格排成 2 欄 × 3 列（第 5 格在左下），欄距 13mm、列距 2mm，皆在 3mm 安全區（x3~207、y3~294）內、
 * 各格之間不重疊。這樣同一筆的地址/主文/陽上明顯屬於同一組，不再左中右散開。
 *
 *   格原點：欄 x = 3 / 105；列 y = 3 / 99 / 195
 *   地址 = 格原點；主文 = 格原點 x+17；陽上 = 格原點 x+69
 */
const THREE_BLOCK_SLOTS: Record<TabletBlockType, Coord[]> = {
  address:   [{ x: 3, y: 3 },  { x: 105, y: 3 },  { x: 3, y: 99 },  { x: 105, y: 99 },  { x: 3, y: 195 }],
  main:      [{ x: 20, y: 3 }, { x: 122, y: 3 },  { x: 20, y: 99 }, { x: 122, y: 99 },  { x: 20, y: 195 }],
  yangshang: [{ x: 72, y: 3 }, { x: 174, y: 3 },  { x: 72, y: 99 }, { x: 174, y: 99 },  { x: 72, y: 195 }],
};

/** 累世冤親債主固定槽位座標（11 槽；只有地址與陽上）。 */
const DEBT_SLOTS: Record<"address" | "yangshang", Coord[]> = {
  address: [3, 19, 35, 51, 67, 83, 99, 115, 131, 147, 163].map((x) => ({ x, y: 3 })),
  yangshang: [
    { x: 179, y: 3 }, { x: 179, y: 74 }, { x: 179, y: 145 }, { x: 179, y: 216 },
    { x: 3, y: 154 }, { x: 24, y: 154 }, { x: 45, y: 154 }, { x: 66, y: 154 },
    { x: 87, y: 154 }, { x: 108, y: 154 }, { x: 129, y: 154 },
  ],
};

/**
 * V30.3 寶袋固定槽位（4 槽；2 欄×2 列）。每筆整組：地址(25w)→間距1→主文(45w)→間距1→陽上(25w)，
 * 整組寬 97mm、高 140mm。欄原點 x=3／104；列原點 y=3／150（皆在 3mm 安全區、各格不重疊、間距≥1mm）。
 *   地址＝格原點；主文＝格原點 x+26；陽上＝格原點 x+72。
 */
const POCKET_SLOTS: Record<TabletBlockType, Coord[]> = {
  address:   [{ x: 3, y: 3 },  { x: 104, y: 3 },  { x: 3, y: 150 },  { x: 104, y: 150 }],
  main:      [{ x: 29, y: 3 }, { x: 130, y: 3 },  { x: 29, y: 150 }, { x: 130, y: 150 }],
  yangshang: [{ x: 75, y: 3 }, { x: 176, y: 3 },  { x: 75, y: 150 }, { x: 176, y: 150 }],
};

/** 取某型別、某區塊、某槽位的「未套 offset」固定座標。 */
export function slotCoord(docType: TabletDocumentType, blockType: TabletBlockType, slotIndex: number): Coord {
  if (docType === "DEBT_CREDITOR") {
    if (blockType === "main") throw new Error("DEBT_CREDITOR 無主文字區");
    return DEBT_SLOTS[blockType][slotIndex];
  }
  if (docType === "POCKET") return POCKET_SLOTS[blockType][slotIndex];
  return THREE_BLOCK_SLOTS[blockType][slotIndex];
}

export function pageIndexOf(docType: TabletDocumentType, recordIndex: number): number {
  return Math.floor(recordIndex / SLOTS_PER_PAGE[docType]);
}
export function slotIndexOf(docType: TabletDocumentType, recordIndex: number): number {
  return recordIndex % SLOTS_PER_PAGE[docType];
}

/** 一筆報名資料的內容（識別值用於配對，不列印）。 */
export type TabletRecordInput = {
  entryId?: string | null;
  registrationId?: string | null;
  /** 已國字化的列印文字（由 toPrintableTablet 產生）。 */
  addressText?: string;
  mainText?: string;
  yangshangText?: string;
};

export type PositionedBlock = {
  recordIndex: number;
  pageIndex: number;
  slotIndex: number;
  blockType: TabletBlockType;
  /** 綁定用（配對正確性）；不進入正式列印內容。 */
  entryId: string | null;
  registrationId: string | null;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** 該區塊列印文字。 */
  text: string;
  /**
   * V33 橫式版：由版面引擎直接算好的字級（px）——已依「可列印範圍最大化且不裁字/不超寬」計算。
   * 有值時渲染端直接採用（不再各自 fontFit），確保預覽＝正式列印完全相同字級。
   */
  fontPx?: number;
  /** V33：即使最小字級仍放不下（極端長字）→ true，渲染端顯示警告、不裁字。 */
  overflow?: boolean;
  /** V33：直書對齊（主文置中、地址與陽上人靠上）。未指定沿用既有規則。 */
  vAlign?: "center" | "start" | "end";
};

export type TabletPage = { pageIndex: number; blocks: PositionedBlock[] };

/** V32 §3 版面來源與 packing 摘要（供預覽顯示 columns/rows/perPage/字級/警告）。 */
export type TabletPackingInfo = {
  /** "packed"＝採用 packing 最高密度配置；"fixed"＝採用既有固定槽位（含 fallback）。 */
  source: "packed" | "fixed";
  columns: number;
  rows: number;
  perPage: number;
  /** 既有固定槽位每頁筆數（基準，供比較）。 */
  baseline: number;
  minFontPx: number;
  warnings: string[];
  /** 若因 packing 無效／未啟用而回退固定槽位，記錄原因。 */
  fallbackReason?: string;
};

export type TabletLayout = {
  documentType: TabletDocumentType;
  slotsPerPage: number;
  offset: TabletA4Offset;
  pages: TabletPage[];
  allBlocks: PositionedBlock[];
  /** V32 §3：本次版面的 packing 摘要（正式 sheet 一律附帶，預覽顯示、正式列印相同配置）。 */
  packing?: TabletPackingInfo;
  /**
   * V33 橫式版：頁面實際尺寸（mm）。橫式＝297×210；未指定沿用既有直式 210×297。
   * 渲染端依此設定 .print-sheet 寬高與 @page 方向。
   */
  pageWidthMm?: number;
  pageHeightMm?: number;
  /** V33：版面自帶的違規（橫式引擎以自身頁面尺寸計算，避免用直式 USABLE 誤判）。 */
  violations?: LayoutViolation[];
};

function textFor(docType: TabletDocumentType, blockType: TabletBlockType, rec: TabletRecordInput): string {
  if (blockType === "address") return rec.addressText ?? "";
  if (blockType === "yangshang") return rec.yangshangText ?? "";
  return rec.mainText ?? "";
}

/**
 * 依固定槽位＋分頁＋offset 產出完整版面。最後一頁只含實際資料，不補空白。
 */
export function buildTabletLayout(
  documentType: TabletDocumentType,
  records: TabletRecordInput[],
  offset: TabletA4Offset = ZERO_OFFSET
): TabletLayout {
  const perPage = SLOTS_PER_PAGE[documentType];
  const blockTypes = DOCUMENT_BLOCKS[documentType];
  const allBlocks: PositionedBlock[] = [];

  records.forEach((rec, recordIndex) => {
    const pageIndex = pageIndexOf(documentType, recordIndex);
    const slotIndex = slotIndexOf(documentType, recordIndex);
    for (const blockType of blockTypes) {
      const c = slotCoord(documentType, blockType, slotIndex);
      const size = blockSizeFor(documentType, blockType);
      allBlocks.push({
        recordIndex,
        pageIndex,
        slotIndex,
        blockType,
        entryId: rec.entryId ?? null,
        registrationId: rec.registrationId ?? null,
        xMm: c.x + offset.offsetXmm,
        yMm: c.y + offset.offsetYmm,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        text: textFor(documentType, blockType, rec),
      });
    }
  });

  const pageMap = new Map<number, PositionedBlock[]>();
  for (const b of allBlocks) (pageMap.get(b.pageIndex) ?? pageMap.set(b.pageIndex, []).get(b.pageIndex)!).push(b);
  const pages: TabletPage[] = Array.from(pageMap.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([pageIndex, blocks]) => ({ pageIndex, blocks }));

  return { documentType, slotsPerPage: perPage, offset, pages, allBlocks };
}

// ────────────────────────────────────────────────────────────
// 驗證函式（納入單元測試）
// ────────────────────────────────────────────────────────────

type Rect = { xMm: number; yMm: number; widthMm: number; heightMm: number };

/** 邊界：整塊需落在 3mm 安全區內。 */
export function inBounds(r: Rect): boolean {
  return (
    r.xMm >= USABLE.x0 - 1e-9 &&
    r.yMm >= USABLE.y0 - 1e-9 &&
    r.xMm + r.widthMm <= USABLE.x1 + 1e-9 &&
    r.yMm + r.heightMm <= USABLE.y1 + 1e-9
  );
}

/** 碰撞＋最小間距：兩矩形需在至少一軸分離 ≥ gap（含不重疊）。 */
export function gapOK(a: Rect, b: Rect, gap: number = TABLET_A4_CONFIG.horizontalGapMm): boolean {
  return (
    a.xMm + a.widthMm + gap <= b.xMm + 1e-9 ||
    b.xMm + b.widthMm + gap <= a.xMm + 1e-9 ||
    a.yMm + a.heightMm + gap <= b.yMm + 1e-9 ||
    b.yMm + b.heightMm + gap <= a.yMm + 1e-9
  );
}

export type LayoutViolation = { code: "OUT_OF_BOUNDS" | "COLLISION" | "CROSS_PAGE"; detail: string };

/**
 * 完整驗證：boundary + rectangle collision + minimum-gap + atomic-record same-page。
 * 回傳所有違規（空陣列＝合法）。
 */
export function validateLayout(layout: TabletLayout): LayoutViolation[] {
  const v: LayoutViolation[] = [];
  const minGap = Math.min(TABLET_A4_CONFIG.horizontalGapMm, TABLET_A4_CONFIG.verticalGapMm);

  // boundary
  for (const b of layout.allBlocks) {
    if (!inBounds(b)) v.push({ code: "OUT_OF_BOUNDS", detail: `rec${b.recordIndex}/${b.blockType} (${b.xMm},${b.yMm},${b.widthMm}x${b.heightMm})` });
  }
  // collision + min-gap（僅同頁）
  for (const page of layout.pages) {
    for (let i = 0; i < page.blocks.length; i++) {
      for (let j = i + 1; j < page.blocks.length; j++) {
        if (!gapOK(page.blocks[i], page.blocks[j], minGap)) {
          v.push({ code: "COLLISION", detail: `p${page.pageIndex}: rec${page.blocks[i].recordIndex}/${page.blocks[i].blockType} vs rec${page.blocks[j].recordIndex}/${page.blocks[j].blockType}` });
        }
      }
    }
  }
  // atomic same-page：同一 recordIndex 的所有區塊 pageIndex 一致
  const recPage = new Map<number, number>();
  for (const b of layout.allBlocks) {
    const seen = recPage.get(b.recordIndex);
    if (seen === undefined) recPage.set(b.recordIndex, b.pageIndex);
    else if (seen !== b.pageIndex) v.push({ code: "CROSS_PAGE", detail: `rec${b.recordIndex} 跨頁 ${seen}/${b.pageIndex}` });
  }
  return v;
}

// ────────────────────────────────────────────────────────────
// V32 §3 Packing 正式接入：由 packing 核心決定版面，安全 fallback 至固定槽位
// ────────────────────────────────────────────────────────────

import { packTabletLayout, type PackDocType, type TabletPackResult } from "./packing";
import type { TabletFontBox } from "./fontFit";

function packDocTypeOf(d: TabletDocumentType): PackDocType {
  if (d === "DEBT_CREDITOR") return "DEBT_CREDITOR";
  if (d === "POCKET") return "POCKET";
  return "THREE_BLOCK";
}

/** TabletFontBox → 版面 TabletBlockType（main 與 pocketMain 皆為主文區）。 */
function blockTypeOfBox(box: TabletFontBox): TabletBlockType {
  if (box === "address") return "address";
  if (box === "yangshang") return "yangshang";
  return "main";
}

/** 由 packing 結果 + 記錄，產出固定式 buildTabletLayout 相同形狀的版面（未驗證前）。 */
function layoutFromPacking(
  documentType: TabletDocumentType,
  records: TabletRecordInput[],
  offset: TabletA4Offset,
  pack: TabletPackResult
): TabletLayout {
  const perPage = pack.perPage;
  const allBlocks: PositionedBlock[] = [];
  records.forEach((rec, recordIndex) => {
    const pageIndex = Math.floor(recordIndex / perPage);
    const slotIndex = recordIndex % perPage;
    const col = slotIndex % pack.columns;
    const row = Math.floor(slotIndex / pack.columns);
    const cellX = pack.colXsMm[col];
    const cellY = pack.rowYsMm[row];
    for (const b of pack.blocks) {
      const blockType = blockTypeOfBox(b.box);
      // 冤親債主無主文區：packing 的 blocks 已不含 main（Safe Area 未列），此處自然略過。
      allBlocks.push({
        recordIndex,
        pageIndex,
        slotIndex,
        blockType,
        entryId: rec.entryId ?? null,
        registrationId: rec.registrationId ?? null,
        xMm: cellX + b.dxMm + offset.offsetXmm,
        yMm: cellY + b.dyMm + offset.offsetYmm,
        widthMm: b.widthMm,
        heightMm: b.heightMm,
        text: textFor(documentType, blockType, rec),
      });
    }
  });
  const pageMap = new Map<number, PositionedBlock[]>();
  for (const b of allBlocks) (pageMap.get(b.pageIndex) ?? pageMap.set(b.pageIndex, []).get(b.pageIndex)!).push(b);
  const pages: TabletPage[] = Array.from(pageMap.entries()).sort((a, b) => a[0] - b[0]).map(([pageIndex, blocks]) => ({ pageIndex, blocks }));
  return { documentType, slotsPerPage: perPage, offset, pages, allBlocks };
}

export type AutoLayoutOptions = {
  /**
   * 是否啟用「高於既有固定槽位」的最高密度排版。預設 false＝維持既有已驗證版型（保護實紙裁切對位），
   * packing 仍會計算並附在 layout.packing 供預覽顯示；true＝當 packing 產出更高且全合法時採用。
   */
  maximize?: boolean;
};

/**
 * V32 §3 正式版面決策（Preview 與正式列印共用）：
 *  1) 以 packing 核心依 Safe Area 與批次最大字數計算最高密度合法配置。
 *  2) 若 maximize 且 packing.perPage > 既有基準、且產出版面通過 validateLayout → 採用 packing 版面。
 *  3) 否則採用既有固定槽位版面（buildTabletLayout），並附 packing 摘要與 fallback 原因。
 * 任一步驟例外或無效 → 一律安全 fallback 至固定槽位，絕不讓正式列印失效。
 */
export function buildAutoTabletLayout(
  documentType: TabletDocumentType,
  records: TabletRecordInput[],
  offset: TabletA4Offset = ZERO_OFFSET,
  options: AutoLayoutOptions = {}
): TabletLayout {
  const baseline = SLOTS_PER_PAGE[documentType];
  const fixed = () => buildTabletLayout(documentType, records, offset);

  // 累世冤親債主採「專用固定版面」（地址橫列＋陽上散排的 11 槽特殊排法，非矩形網格）。
  // 矩形 packing 無法安全重現該排法，且其密度已優化，故一律使用既有固定版面（packing 摘要仍附）。
  if (documentType === "DEBT_CREDITOR") {
    const l = fixed();
    l.packing = { source: "fixed", columns: 0, rows: 0, perPage: baseline, baseline, minFontPx: 0, warnings: [], fallbackReason: "冤親債主採專用固定版面（非矩形網格）" };
    return l;
  }

  let pack: TabletPackResult | null = null;
  try {
    const maxChars = (pick: (r: TabletRecordInput) => string | undefined) =>
      records.reduce((m, r) => Math.max(m, (pick(r) ?? "").length), 0);
    pack = packTabletLayout({
      docType: packDocTypeOf(documentType),
      maxCharsByBox: {
        address: maxChars((r) => r.addressText),
        main: maxChars((r) => r.mainText),
        pocketMain: maxChars((r) => r.mainText),
        yangshang: maxChars((r) => r.yangshangText),
      },
      marginMm: TABLET_A4_CONFIG.marginLeftMm,
      gapMm: TABLET_A4_CONFIG.horizontalGapMm,
    });
  } catch {
    pack = null;
  }

  const packingInfo = (source: "packed" | "fixed", perPage: number, columns: number, rows: number, fallbackReason?: string): TabletPackingInfo => ({
    source,
    columns,
    rows,
    perPage,
    baseline,
    minFontPx: pack?.minFontPx ?? 0,
    warnings: pack?.warnings ?? [],
    fallbackReason,
  });

  // 未算出、不可行、或未達密度提升 → 固定槽位（附 packing 摘要供預覽）。
  if (!pack || !pack.feasible || pack.perPage <= 0) {
    const l = fixed();
    l.packing = packingInfo("fixed", baseline, 0, 0, pack ? "packing 無合法配置或字溢，回退固定槽位" : "packing 計算例外，回退固定槽位");
    return l;
  }
  if (!options.maximize || pack.perPage <= baseline) {
    const l = fixed();
    l.packing = packingInfo("fixed", baseline, pack.columns, pack.rows, !options.maximize ? "未啟用最高密度（保護既有版型）" : "packing 未高於既有基準");
    return l;
  }

  // 嘗試採用 packing 版面，並以既有 validateLayout 完整驗證（超界/碰撞/跨頁）。
  const candidate = layoutFromPacking(documentType, records, offset, pack);
  const violations = validateLayout(candidate);
  if (violations.length > 0) {
    const l = fixed();
    l.packing = packingInfo("fixed", baseline, pack.columns, pack.rows, `packing 版面驗證未過（${violations[0].code}），回退固定槽位`);
    return l;
  }
  candidate.packing = packingInfo("packed", pack.perPage, pack.columns, pack.rows);
  return candidate;
}

/** offset 是否使任何區塊超出安全範圍（供預覽/列印前阻擋）。 */
export function isOffsetWithinBounds(documentType: TabletDocumentType, offset: TabletA4Offset): boolean {
  // 以「滿頁」的固定槽位檢查最嚴格情況。
  const perPage = SLOTS_PER_PAGE[documentType];
  const dummy: TabletRecordInput[] = Array.from({ length: perPage }, () => ({}));
  const layout = buildTabletLayout(documentType, dummy, offset);
  return layout.allBlocks.every((b) => inBounds(b));
}
