/**
 * V36.11 牌位「主文」字串清理 + 共用字級規則（純函式，無 DOM／DB，可單元測試）。
 *
 * 目的：讓歷代祖先／乙位正魂／累世冤親債主／無緣子女**四類**主文共用同一套字級規則，
 * 相同字數＋相同版型 → 視覺字級一致；只有實際超出既定 bounding box 才縮小。
 *
 * 縮字誤判根因：auto-fit 以「字串長度」估算字級，但主文若夾帶不可見空白／換行／全形空白，
 * 長度被灌水 → 被誤縮。故一律先 cleanTabletMainText() 清乾淨，再進 auto-fit。
 *
 * 寶袋（POCKET）維持原本較小字級，不套用本規則。
 */

/**
 * 清理主文字串：移除所有空白／換行／定位／不可見字元
 * （一般 \s、NBSP U+00A0、全形空白 U+3000、zero-width U+200B–U+200D、word-joiner U+2060、BOM U+FEFF）。
 * 牌位主文（姓名＋稱謂，如「陳永成乙位正魂」「累世冤親債主」「○姓歷代祖先」「本宅地基主」）本不含空白，
 * 故一律移除，讓長度＝實際可見字數，auto-fit 不被灌水誤判。
 */
export function cleanTabletMainText(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.replace(/[\s 　​‌‍⁠﻿]/g, "");
}

/** 主文可見字數（清理後）。 */
export function tabletMainCharCount(raw: string | null | undefined): number {
  return cleanTabletMainText(raw).length;
}

/**
 * 四類牌位主文共用字級 token（mm）。供 V34 橫式版型使用；四類一律相同，不依資料來源／entryId／
 * 匯入或手動而異。autoFitThreshold＝在固定 bounding box 內、基準字級可容納的字數上限（超過才縮）。
 */
export const TABLET_MAIN_FIT = {
  /** 基準字級（mm）——V36.14 由 9.9→13（一頁 7 筆、欄變寬後主文放大，接近設計字級）。 */
  baseSizeMm: 13,
  lineHeight: 1.05,
  /** 基準字級下、主文 bounding box（直書滿高）可容納的字數上限；≤ 此值不縮小。 */
  autoFitThreshold: 12,
  /** 最小字級（mm），縮到此為止。 */
  minSizeMm: 6.0,
  /** 每超出 1 字的縮放比例（近似等比縮字）。 */
  shrinkRatio: 0.92,
} as const;

export type TabletMainFitConfig = typeof TABLET_MAIN_FIT;

/**
 * 依「清理後字數」計算 V34 主文字級（mm）。四類共用同一 config；相同字數 → 相同字級。
 * 只有字數超過 autoFitThreshold（會超出 bounding box）才等比縮小，夾在 minSizeMm。
 */
export function fitV34MainSizeMm(charCount: number, cfg: TabletMainFitConfig = TABLET_MAIN_FIT): number {
  const n = Math.max(0, Math.floor(charCount));
  if (n <= cfg.autoFitThreshold) return cfg.baseSizeMm;
  const over = n - cfg.autoFitThreshold;
  const size = cfg.baseSizeMm * Math.pow(cfg.shrinkRatio, over);
  return Math.max(cfg.minSizeMm, Math.round(size * 100) / 100);
}
