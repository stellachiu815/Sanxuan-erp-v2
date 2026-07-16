/**
 * A4 小人頭貼紙「智慧版面最佳化」演算法（V9.0「祭改管理與小人頭貼紙列印」新增）。
 *
 * 純函式、不 import 任何其他模組，方便在沙盒環境用 `tsx --test` 直接執行
 * 自動測試（見 tests/purificationLayout.test.ts）。
 *
 * ⚠️ 目前沒有拿到官方「113小人頭1-33」Word 範本檔案（使用者確認：先用
 * 合理預設值開發，之後範本檔案送到後，只需要調整這個檔案裡
 * COLUMN_FONT_TIERS 的數字即可微調，不需要重寫功能本身）。這裡的字體
 * pt 數與每一階字級能容納的字數，都是預設值，非官方正式規格。
 *
 * 設計原則（對應需求「十、字體大小與智慧最佳化」「十一、最佳化版面按鈕」）：
 * 1. 貼紙尺寸、格距、外框、3欄×11列排列固定不變，這個演算法「只」決定
 *    三個欄位（編號姓名欄／年齡生日吉時欄／地址欄）各自的字體大小與字距，
 *    絕對不會改變格子大小或整張貼紙尺寸。
 * 2. 三個欄位彼此獨立最佳化：地址很長只影響地址欄，生日文字很長只影響
 *    中間欄，不會因為某一欄內容多，就縮小其他欄或其他 32 格。
 * 3. 姓名欄字級階梯直接對應需求列出的規則：二字姓名放大／三字姓名標準／
 *    四字姓名微調／五字以上才縮小該欄——不是單純「越長越縮小」的通用公式，
 *    而是照抄需求給的分級規則。
 * 4. 每一欄都有「最小字級」；如果字數多到連最小字級都放不下，回傳
 *    fits=false，交給呼叫端列入「人工確認清單」，絕不硬擠、重疊、
 *    截字，也不會把直式內容自動改成橫式。
 * 5. 編號本身（阿拉伯數字，橫式）不參與這裡的字級縮放邏輯——編號固定用
 *    `text-combine-upright` 這類 CSS 技巧「嵌」在直式欄位裡橫向呈現，
 *    版面元件（PurificationPrintCell）另外處理，不受字數多寡影響。
 */

export type ColumnKind = "NAME" | "MIDDLE" | "ADDRESS";

export type FontTier = {
  /** 0 = 官方預設（最大/標準字級），數字越大代表縮得越小。 */
  level: number;
  fontSizePt: number;
  letterSpacingPt: number;
  /** 這個字級下，這一欄固定高度大約能放下的字數上限。 */
  charsCapacity: number;
};

/**
 * 各欄字級階梯（由大到小）。之後有官方範本時，只需要調整這裡的數字。
 *
 * NAME 欄刻意不是單純「字數越多字級越小」的通用公式，而是直接對應需求
 * 條列的規則：二字姓名可適度放大（level 0）／三字姓名標準字體（level 1）／
 * 四字姓名微調字體及字距（level 2）／五字以上只縮小姓名欄（level 3+）。
 */
export const COLUMN_FONT_TIERS: Record<ColumnKind, FontTier[]> = {
  NAME: [
    { level: 0, fontSizePt: 36, letterSpacingPt: 8, charsCapacity: 2 },
    { level: 1, fontSizePt: 30, letterSpacingPt: 6, charsCapacity: 3 },
    { level: 2, fontSizePt: 26, letterSpacingPt: 3, charsCapacity: 4 },
    { level: 3, fontSizePt: 20, letterSpacingPt: 1, charsCapacity: 6 },
    { level: 4, fontSizePt: 16, letterSpacingPt: 0, charsCapacity: 8 },
  ],
  MIDDLE: [
    { level: 0, fontSizePt: 14, letterSpacingPt: 2, charsCapacity: 11 },
    { level: 1, fontSizePt: 12, letterSpacingPt: 1, charsCapacity: 13 },
    { level: 2, fontSizePt: 10, letterSpacingPt: 0.5, charsCapacity: 15 },
    { level: 3, fontSizePt: 9, letterSpacingPt: 0, charsCapacity: 18 },
  ],
  ADDRESS: [
    { level: 0, fontSizePt: 12, letterSpacingPt: 1, charsCapacity: 14 },
    { level: 1, fontSizePt: 10, letterSpacingPt: 0.5, charsCapacity: 17 },
    { level: 2, fontSizePt: 9, letterSpacingPt: 0, charsCapacity: 20 },
    { level: 3, fontSizePt: 8, letterSpacingPt: 0, charsCapacity: 26 },
  ],
};

export type ColumnOptimizationResult = {
  column: ColumnKind;
  charCount: number;
  chosenTier: FontTier;
  /** false 代表縮到這一欄最小字級仍然放不下，需要人工確認，不是程式的錯。 */
  fits: boolean;
};

/** 正確計算字串的「字元數」（用展開運算子，避免多位元組字元被算成 2 個字）。 */
function countChars(text: string): number {
  return [...text].length;
}

/** 針對單一欄位（姓名／中間／地址）挑選字級：從最大字級開始，找第一個裝得下的。 */
export function optimizeColumn(column: ColumnKind, text: string): ColumnOptimizationResult {
  const charCount = countChars(text);
  const tiers = COLUMN_FONT_TIERS[column];
  for (const tier of tiers) {
    if (charCount <= tier.charsCapacity) {
      return { column, charCount, chosenTier: tier, fits: true };
    }
  }
  const smallestTier = tiers[tiers.length - 1];
  return { column, charCount, chosenTier: smallestTier, fits: false };
}

export type CellContent = {
  /** 祭改編號，橫式阿拉伯數字，不參與這裡的字級縮放。 */
  numberText: string;
  nameText: string;
  /** 歲數＋農曆生日＋吉時建生/瑞生，已經組成一整串直式文字。 */
  middleText: string;
  addressText: string;
};

export type CellOptimizationResult = {
  name: ColumnOptimizationResult;
  middle: ColumnOptimizationResult;
  address: ColumnOptimizationResult;
  needsManualReview: boolean;
  reviewReasons: string[];
};

/** 針對一格小人頭的三個欄位分別最佳化，彼此互不影響。 */
export function optimizeCell(content: CellContent): CellOptimizationResult {
  const name = optimizeColumn("NAME", content.nameText);
  const middle = optimizeColumn("MIDDLE", content.middleText);
  const address = optimizeColumn("ADDRESS", content.addressText);

  const reviewReasons: string[] = [];
  if (!name.fits) {
    reviewReasons.push(`姓名「${content.nameText}」（${name.charCount} 字）縮到最小字體仍放不下`);
  }
  if (!middle.fits) {
    reviewReasons.push(`歲數／生日／吉時文字（${middle.charCount} 字）縮到最小字體仍放不下`);
  }
  if (!address.fits) {
    reviewReasons.push(`地址「${content.addressText}」（${address.charCount} 字）縮到最小字體仍放不下`);
  }

  return { name, middle, address, needsManualReview: reviewReasons.length > 0, reviewReasons };
}

export type IndexedCellOptimizationResult = CellOptimizationResult & {
  index: number;
  numberText: string;
  nameText: string;
};

export type BatchOptimizationSummary = {
  totalCells: number;
  adjustedCount: number;
  /** 哪幾筆有任何一欄被縮小過字級（level > 0），依原始索引排序。 */
  adjustedCells: { index: number; numberText: string; nameText: string }[];
  /** 哪幾筆縮到最小字級仍然放不下，需要人工確認。 */
  needsReviewCells: { index: number; numberText: string; nameText: string; reasons: string[] }[];
};

/**
 * 批次最佳化：對一整批（通常是一整張 A4 33 格）小人頭內容分別做
 * optimizeCell，並整理出「已自動調整幾筆」「哪幾筆縮小字體」
 * 「哪幾筆仍需人工確認」的摘要，對應【最佳化版面】按鈕按下後要顯示的內容。
 */
export function optimizeBatch(cells: readonly CellContent[]): {
  results: IndexedCellOptimizationResult[];
  summary: BatchOptimizationSummary;
} {
  const results: IndexedCellOptimizationResult[] = cells.map((cell, index) => ({
    index,
    numberText: cell.numberText,
    nameText: cell.nameText,
    ...optimizeCell(cell),
  }));

  const adjustedCells = results
    .filter((r) => r.name.chosenTier.level > 0 || r.middle.chosenTier.level > 0 || r.address.chosenTier.level > 0)
    .map((r) => ({ index: r.index, numberText: r.numberText, nameText: r.nameText }));

  const needsReviewCells = results
    .filter((r) => r.needsManualReview)
    .map((r) => ({ index: r.index, numberText: r.numberText, nameText: r.nameText, reasons: r.reviewReasons }));

  return {
    results,
    summary: {
      totalCells: results.length,
      adjustedCount: adjustedCells.length,
      adjustedCells,
      needsReviewCells,
    },
  };
}
