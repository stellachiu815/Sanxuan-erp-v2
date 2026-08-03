/**
 * V31 牌位／寶袋直式文字「自動字級縮放」純函式（無 React，可測試）。
 *
 * 每個 Bounding Box 各自獨立計算：依字數、可用寬高（mm）、直行數、行距、字距、writing-mode(直式) 估算
 * 可容納字數，從 maxPx 逐級（stepPx）降到 minPx，取第一個放得下的字級；文字少時維持 maxPx（不放大超過
 * 基準），文字多時逐級縮小；連 minPx 都放不下 → 回 minPx 並標記 overflow（**不裁字**，由呼叫端警告／阻擋）。
 */
export type FontFitConfig = { maxPx: number; minPx: number; stepPx: number };
export type FontFitResult = { px: number; overflow: boolean; lines: number; capacityAtPx: number };

const PX_PER_MM = 3.7795275591;

/**
 * 直式文字某盒內的合適字級。
 * - 每直行可容納字數 ≈ floor(盒高px / (px×lineHeight))。
 * - 可用直行數 ≈ floor(盒寬px / (px×colSpacing))。
 * - 容量 = 每行字數 × 直行數。
 */
export function fitVerticalFont(
  charCount: number,
  boxWidthMm: number,
  boxHeightMm: number,
  cfg: FontFitConfig,
  opts?: { lineHeight?: number; colSpacing?: number }
): FontFitResult {
  const lineHeight = opts?.lineHeight ?? 1.15;
  const colSpacing = opts?.colSpacing ?? 1.08;
  const n = Math.max(0, charCount);

  const capacityAt = (px: number) => {
    const perCol = Math.max(1, Math.floor((boxHeightMm * PX_PER_MM) / (px * lineHeight)));
    const cols = Math.max(1, Math.floor((boxWidthMm * PX_PER_MM) / (px * colSpacing)));
    return { perCol, capacity: perCol * cols };
  };

  // 空字串／0 → 基準字級、不 overflow。
  if (n === 0) return { px: cfg.maxPx, overflow: false, lines: 0, capacityAtPx: capacityAt(cfg.maxPx).capacity };

  for (let px = cfg.maxPx; px >= cfg.minPx; px -= cfg.stepPx) {
    const { perCol, capacity } = capacityAt(px);
    if (n <= capacity) return { px, overflow: false, lines: Math.ceil(n / perCol), capacityAtPx: capacity };
  }
  // 連最小字級都放不下：回 minPx + overflow（不裁字）。
  const { perCol, capacity } = capacityAt(cfg.minPx);
  return { px: cfg.minPx, overflow: true, lines: Math.ceil(n / perCol), capacityAtPx: capacity };
}

/**
 * 各 Bounding Box 的字級設定（max/min/step）——**各自獨立**，不共用同一字級。
 * `main` 為祖先／乙位正魂／**無緣子女共用**的主文設定（單一來源）：無緣子女短文字最大不超過 maxPx，
 * 只有超過可容納範圍才依同一規則逐級縮小（見補充規格）。
 */
export const FONT_CONFIG = {
  /** 三區塊主文（祖先／乙位／無緣共用，基準 40px）。 */
  main: { maxPx: 40, minPx: 20, stepPx: 2 } as FontFitConfig,
  /** 直式地址。 */
  address: { maxPx: 16, minPx: 9, stepPx: 1 } as FontFitConfig,
  /** 陽上人。 */
  yangshang: { maxPx: 20, minPx: 11, stepPx: 1 } as FontFitConfig,
  /** 寶袋主文／指定名稱。 */
  pocketMain: { maxPx: 30, minPx: 16, stepPx: 2 } as FontFitConfig,
};

/**
 * V33 陽上人專用縮字：確保「姓名＋叩薦」完整放入固定欄，絕不跨欄/裁字。處理順序（規格）：
 *   1) 逐級縮小字級（maxPx→minPx）。
 *   2) 仍放不下 → 於最小字級縮小**字距**（letterSpacing，直書字元間距，負值收緊）。
 *   3) 仍放不下 → 再縮小**行距**（lineHeight，直書欄間距）。
 *   4) 皆放不下 → overflow=true（呼叫端顯示「需人工調整」，不裁字、不跨欄）。
 * 只作用於陽上人；主文/地址各自獨立計算、不受影響。回傳 CSS 用 fontPx/lineHeight/letterSpacingPx。
 */
export type YangshangFitResult = { px: number; lineHeight: number; letterSpacingPx: number; overflow: boolean };

export function fitYangshangVertical(
  charCount: number,
  boxWidthMm: number,
  boxHeightMm: number,
  cfg: FontFitConfig
): YangshangFitResult {
  const PX_PER_MM = 3.7795275591;
  // 單字寬不超欄：字級上限。
  const widthCapPx = Math.max(cfg.minPx, Math.floor((boxWidthMm * PX_PER_MM) / 1.08));
  const capMax = Math.min(cfg.maxPx, widthCapPx);

  // 1) 正常字距/行距下逐級縮字級。
  const normal = fitVerticalFont(charCount, boxWidthMm, boxHeightMm, { maxPx: capMax, minPx: cfg.minPx, stepPx: cfg.stepPx }, { lineHeight: 1.15, colSpacing: 1.08 });
  if (!normal.overflow) return { px: normal.px, lineHeight: 1.08, letterSpacingPx: 0, overflow: false };

  const minCfg = { maxPx: cfg.minPx, minPx: cfg.minPx, stepPx: 1 };
  // 2) 最小字級下，收緊「字距」（fitVerticalFont 的 lineHeight＝直書字元前進量）。
  for (const ls of [1.05, 0.98, 0.9]) {
    const r = fitVerticalFont(charCount, boxWidthMm, boxHeightMm, minCfg, { lineHeight: ls, colSpacing: 1.08 });
    if (!r.overflow) return { px: cfg.minPx, lineHeight: 1.08, letterSpacingPx: Math.round((ls - 1.15) * cfg.minPx), overflow: false };
  }
  // 3) 再收緊「行距」（colSpacing＝直書欄前進量 → CSS line-height）。
  for (const cs of [1.0, 0.92, 0.85]) {
    const r = fitVerticalFont(charCount, boxWidthMm, boxHeightMm, minCfg, { lineHeight: 0.9, colSpacing: cs });
    if (!r.overflow) return { px: cfg.minPx, lineHeight: cs, letterSpacingPx: Math.round((0.9 - 1.15) * cfg.minPx), overflow: false };
  }
  // 4) 仍放不下 → 需人工調整（不裁字、不跨欄；呼叫端顯示警告）。
  return { px: cfg.minPx, lineHeight: 0.85, letterSpacingPx: Math.round((0.9 - 1.15) * cfg.minPx), overflow: true };
}

export type TabletFontBox = "main" | "address" | "yangshang" | "pocketMain";

/** 取某盒的字級設定（單一來源；祖先與無緣子女主文都取 FONT_CONFIG.main，不各自 hard-code）。 */
export function fontConfigFor(box: TabletFontBox): FontFitConfig {
  return FONT_CONFIG[box];
}
