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

export type TabletFontBox = "main" | "address" | "yangshang" | "pocketMain";

/** 取某盒的字級設定（單一來源；祖先與無緣子女主文都取 FONT_CONFIG.main，不各自 hard-code）。 */
export function fontConfigFor(box: TabletFontBox): FontFitConfig {
  return FONT_CONFIG[box];
}
