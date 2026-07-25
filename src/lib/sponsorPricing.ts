/**
 * V15R2：贊普／隨喜贊普金額純函式（不 import Prisma，可 tsx 直接測）。
 *
 * 金額＝數量 × 單價，為**後端唯一計算來源**，不信任前端送來的 total。
 * 未勾贊普、單價缺漏（null/undefined）、單價 < 0、數量非 ≥1 整數 → 一律 0（不出現 NaN）。
 * 以整數新臺幣處理。贊普與隨喜贊普各自套用同一公式、各自獨立金額。
 */
export function computeSponsorAmount(
  isSponsor: boolean,
  quantity: number | null | undefined,
  unitPrice: number | null | undefined
): number {
  if (!isSponsor) return 0;
  const qty = Math.floor(Number(quantity));
  const unit = unitPrice === null || unitPrice === undefined ? NaN : Number(unitPrice);
  if (!Number.isFinite(qty) || qty < 1) return 0;
  if (!Number.isFinite(unit) || unit < 0) return 0;
  return Math.round(qty * unit);
}
