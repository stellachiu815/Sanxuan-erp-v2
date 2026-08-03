/**
 * V32 §18 / §3 A4 單頁最大化排版（純函式，可測試）。
 *
 * 不硬寫 5/11/4：依 A4 可用區、各區塊 Safe Area（文字最大可用範圍，非固定 slot）、間距與裁切白邊，
 * 枚舉「欄×列」候選，從單頁筆數最多者往下，取第一個「全部合法」的配置為建議版面；並以 fontFit 檢查
 * 每區塊在該格尺寸下的最小可讀字級（BELOW_MIN_FONT / TEXT_OVERFLOW），不裁字。
 *
 * 合法性：不超出可用區(OUT_OF_BOUNDS)、欄列不重疊(COLLISION 由 gap 保證)、單筆不跨頁(CROSS_PAGE)、
 * 不低於可讀字級(BELOW_MIN_FONT)、不字溢(TEXT_OVERFLOW)、每格不小於可讀高度(CUT/密度下限)。
 *
 * 正式 sheet（universalSalvationTabletA4.buildAutoTabletLayout）呼叫本核心決定版面；預覽與正式列印
 * 使用完全相同結果。異常或無合法配置時由呼叫端安全 fallback 至既有固定槽位版面。
 */

import { fitVerticalFont, fontConfigFor, type TabletFontBox } from "./fontFit";

export const A4_MM = { width: 210, height: 297 } as const;

export type PackingInput = {
  /** 一筆記錄整組的最大寬（三區塊＝address+gap+main+gap+yangshang；冤親＝address+gap+yangshang；寶袋＝同三區塊）。 */
  recordWidthMm: number;
  /** 一筆記錄整組的最大高（取各區塊 Safe Area 高的最大值）。 */
  recordHeightMm: number;
  marginMm?: number; // 四周安全邊界（預設 3）
  gapMm?: number; // 物件間最小間距（預設 1）
};

export type PackingResult = {
  columns: number;
  rows: number;
  perPage: number;
  usableWidthMm: number;
  usableHeightMm: number;
  /** 紙張利用率（perPage × 記錄面積 / 可用面積），供比較密度。 */
  utilization: number;
};

/** 依輸入計算單頁最高合法筆數的欄×列配置（幾何層，不含字級檢查）。 */
export function computePacking(input: PackingInput): PackingResult {
  const margin = input.marginMm ?? 3;
  const gap = input.gapMm ?? 1;
  const usableWidthMm = A4_MM.width - margin * 2;
  const usableHeightMm = A4_MM.height - margin * 2;

  // n 個並排（含 n-1 個 gap）所需長度 = n*size + (n-1)*gap ≤ avail  →  n ≤ (avail+gap)/(size+gap)
  const maxFit = (avail: number, size: number) => Math.max(0, Math.floor((avail + gap) / (size + gap)));
  const columns = maxFit(usableWidthMm, input.recordWidthMm);
  const rows = maxFit(usableHeightMm, input.recordHeightMm);
  const perPage = Math.max(0, columns * rows);
  const recordArea = input.recordWidthMm * input.recordHeightMm;
  const utilization = usableWidthMm * usableHeightMm > 0 ? (perPage * recordArea) / (usableWidthMm * usableHeightMm) : 0;

  return { columns, rows, perPage, usableWidthMm, usableHeightMm, utilization };
}

/** 分頁：N 筆、每頁 perPage → 各頁筆數（同一筆不跨頁）。 */
export function paginate(total: number, perPage: number): number[] {
  if (perPage <= 0) return [];
  const pages: number[] = [];
  for (let i = 0; i < total; i += perPage) pages.push(Math.min(perPage, total - i));
  return pages;
}

// ────────────────────────────────────────────────────────────
// V32 §3 牌位/寶袋 Safe Area 導向的最高密度排版
// ────────────────────────────────────────────────────────────

export type PackDocType = "THREE_BLOCK" | "DEBT_CREDITOR" | "POCKET";

/** 一個區塊的 Safe Area（文字最大可用範圍，mm）＋字級盒別（供 fontFit）。 */
export type SafeBlock = { box: TabletFontBox; maxWidthMm: number; maxHeightMm: number };

/**
 * V32 §3 各型別 Safe Area（文字最大可用範圍，非固定 slot；由需求方 cm 值換算）：
 *   三區塊（祖先/乙位/無緣）：地址 1.5×15、主文 5×10、陽上 2×7（cm）
 *   冤親：地址 1.5×15、陽上 2×7（cm）
 *   寶袋：地址 2.5×14、主文 4.5×6、陽上 2.5×6.5（cm）
 */
export const TABLET_SAFE_AREA: Record<PackDocType, SafeBlock[]> = {
  THREE_BLOCK: [
    { box: "address", maxWidthMm: 15, maxHeightMm: 150 },
    { box: "main", maxWidthMm: 50, maxHeightMm: 100 },
    { box: "yangshang", maxWidthMm: 20, maxHeightMm: 70 },
  ],
  DEBT_CREDITOR: [
    { box: "address", maxWidthMm: 15, maxHeightMm: 150 },
    { box: "yangshang", maxWidthMm: 20, maxHeightMm: 70 },
  ],
  POCKET: [
    { box: "address", maxWidthMm: 25, maxHeightMm: 140 },
    { box: "pocketMain", maxWidthMm: 45, maxHeightMm: 60 },
    { box: "yangshang", maxWidthMm: 25, maxHeightMm: 65 },
  ],
};

/**
 * 每格可讀高度下限（mm）——即目前已驗證可正常列印的壓縮高度，作為密度上限的安全底線，
 * 避免為衝高筆數而把每格壓到不可讀。低於此高度的候選一律不採用。
 */
export const MIN_SLOT_HEIGHT_MM: Record<PackDocType, number> = {
  THREE_BLOCK: 94,
  DEBT_CREDITOR: 70,
  POCKET: 140,
};

export type PackWarningCode = "BELOW_MIN_FONT" | "TEXT_OVERFLOW" | "NO_LEGAL_PACKING";

export type TabletPackResult = {
  feasible: boolean;
  columns: number;
  rows: number;
  perPage: number;
  /** 每格內每區塊的相對位移與尺寸（供產生座標）。 */
  recordWidthMm: number;
  slotHeightMm: number;
  blocks: { box: TabletFontBox; dxMm: number; dyMm: number; widthMm: number; heightMm: number }[];
  /** 各欄的 x 原點、各列的 y 原點（含 offset 前）。 */
  colXsMm: number[];
  rowYsMm: number[];
  minFontPx: number;
  warnings: PackWarningCode[];
};

export type TabletPackInput = {
  docType: PackDocType;
  /** 每區塊此批次的最大文字字數（供 fontFit 檢查最小可讀字級／字溢）。 */
  maxCharsByBox: Partial<Record<TabletFontBox, number>>;
  marginMm?: number;
  gapMm?: number;
};

/**
 * 依 Safe Area 與批次最大字數，計算最高密度且全合法的欄×列配置與座標。
 * 水平方向區塊寬固定為 Safe Area 寬（不壓縮）；垂直以「可讀高度下限」為每格高，最大化列數。
 */
export function packTabletLayout(input: TabletPackInput): TabletPackResult {
  const margin = input.marginMm ?? 3;
  const gap = input.gapMm ?? 1;
  const usableW = A4_MM.width - margin * 2;
  const usableH = A4_MM.height - margin * 2;
  const safe = TABLET_SAFE_AREA[input.docType];
  const minSlotH = MIN_SLOT_HEIGHT_MM[input.docType];

  // 記錄水平佈局：區塊由左至右緊鄰，區塊間 gap。
  let cursor = 0;
  const hBlocks = safe.map((b, i) => {
    const dx = cursor;
    cursor += b.maxWidthMm + (i < safe.length - 1 ? gap : 0);
    return { box: b.box, dxMm: dx, maxWidthMm: b.maxWidthMm, maxHeightMm: b.maxHeightMm };
  });
  const recordWidthMm = cursor;

  const maxFit = (avail: number, size: number) => Math.max(0, Math.floor((avail + gap) / (size + gap)));
  const columns = maxFit(usableW, recordWidthMm);
  // 以可讀高度下限為每格高，取最大列數。
  const rows = maxFit(usableH, minSlotH);
  const warnings: PackWarningCode[] = [];

  if (columns < 1 || rows < 1) {
    return {
      feasible: false, columns: 0, rows: 0, perPage: 0, recordWidthMm, slotHeightMm: 0,
      blocks: [], colXsMm: [], rowYsMm: [], minFontPx: 0, warnings: ["NO_LEGAL_PACKING"],
    };
  }

  const slotHeightMm = minSlotH;

  // 各區塊在格內的尺寸：寬＝Safe Area 寬；高＝min(Safe Area 高, 格高)。
  const blocks = hBlocks.map((b) => ({
    box: b.box,
    dxMm: b.dxMm,
    dyMm: 0,
    widthMm: b.maxWidthMm,
    heightMm: Math.min(b.maxHeightMm, slotHeightMm),
  }));

  // fontFit：每區塊在該尺寸下，該批次最大字數是否 >= 最小可讀字級、不字溢。
  let minFontPx = Number.POSITIVE_INFINITY;
  for (const b of blocks) {
    const chars = input.maxCharsByBox[b.box] ?? 0;
    const fit = fitVerticalFont(chars, b.widthMm, b.heightMm, fontConfigFor(b.box));
    minFontPx = Math.min(minFontPx, fit.px);
    if (fit.overflow) warnings.push("TEXT_OVERFLOW");
  }
  if (!Number.isFinite(minFontPx)) minFontPx = 0;

  // 座標：欄、列在可用區內平均分佈（>1 時把剩餘空間平均攤到各格間距；=1 時置原點）。
  // stride = (avail - size)/(count-1) 為相鄰格原點距；因 columns/rows 由 maxFit 保證 count*size+(count-1)*gap≤avail，
  // 故 stride ≥ size+gap，格間必 ≥ gap、不重疊、不超界。
  const spread = (count: number, size: number, avail: number, origin: number): number[] => {
    if (count <= 1) return [origin];
    const stride = (avail - size) / (count - 1);
    return Array.from({ length: count }, (_, i) => origin + i * stride);
  };
  const colXsMm = spread(columns, recordWidthMm, usableW, margin);
  const rowYsMm = spread(rows, slotHeightMm, usableH, margin);

  return {
    feasible: warnings.filter((w) => w === "TEXT_OVERFLOW").length === 0,
    columns,
    rows,
    perPage: columns * rows,
    recordWidthMm,
    slotHeightMm,
    blocks,
    colXsMm,
    rowYsMm,
    minFontPx,
    warnings,
  };
}
