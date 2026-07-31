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

export type TabletDocumentType = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "UNBORN_CHILD" | "DEBT_CREDITOR";
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

/** 取某型別、某區塊的實體尺寸：冤親債主用 BLOCK_SIZE，其餘三區塊型用緊密成組的 THREE_BLOCK_SIZE。 */
export function blockSizeFor(documentType: TabletDocumentType, blockType: TabletBlockType): { widthMm: number; heightMm: number } {
  return documentType === "DEBT_CREDITOR" ? BLOCK_SIZE[blockType] : THREE_BLOCK_SIZE[blockType];
}

/** documentType → 該型別包含哪些區塊（順序即渲染順序）。冤親債主無主文字。 */
export const DOCUMENT_BLOCKS: Record<TabletDocumentType, TabletBlockType[]> = {
  ANCESTOR_LINE: ["address", "main", "yangshang"],
  INDIVIDUAL_SOUL: ["address", "main", "yangshang"],
  UNBORN_CHILD: ["address", "main", "yangshang"],
  DEBT_CREDITOR: ["address", "yangshang"],
};

/** 每頁固定筆數。 */
export const SLOTS_PER_PAGE: Record<TabletDocumentType, number> = {
  ANCESTOR_LINE: 5,
  INDIVIDUAL_SOUL: 5,
  UNBORN_CHILD: 5,
  DEBT_CREDITOR: 11,
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

/** 取某型別、某區塊、某槽位的「未套 offset」固定座標。 */
export function slotCoord(docType: TabletDocumentType, blockType: TabletBlockType, slotIndex: number): Coord {
  if (docType === "DEBT_CREDITOR") {
    if (blockType === "main") throw new Error("DEBT_CREDITOR 無主文字區");
    return DEBT_SLOTS[blockType][slotIndex];
  }
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
};

export type TabletPage = { pageIndex: number; blocks: PositionedBlock[] };
export type TabletLayout = {
  documentType: TabletDocumentType;
  slotsPerPage: number;
  offset: TabletA4Offset;
  pages: TabletPage[];
  allBlocks: PositionedBlock[];
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

/** offset 是否使任何區塊超出安全範圍（供預覽/列印前阻擋）。 */
export function isOffsetWithinBounds(documentType: TabletDocumentType, offset: TabletA4Offset): boolean {
  // 以「滿頁」的固定槽位檢查最嚴格情況。
  const perPage = SLOTS_PER_PAGE[documentType];
  const dummy: TabletRecordInput[] = Array.from({ length: perPage }, () => ({}));
  const layout = buildTabletLayout(documentType, dummy, offset);
  return layout.allBlocks.every((b) => inBounds(b));
}
