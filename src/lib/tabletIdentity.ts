/**
 * V15R6：普渡命名牌位（歷代祖先／乙位正魂／無緣子女／冤親債主）的「單一牌位識別」。
 *
 * 用途：auto-draft 自動展開（每筆既有牌位各建一筆草稿）與編輯頁手動新增，
 * **共用同一套 per-tablet 冪等判斷**，確保：
 *   - 返回後重新進入不重複建立相同牌位；
 *   - 同名但確實為不同牌位（地址不同）不被錯誤合併；
 *   - 有既有來源 ID 時優先用來源 ID（穩定、跨重入一致）。
 *
 * 冪等鍵組成（規格五）：
 *   category ＋ 標準化 displayName ＋ 標準化 tabletAddress
 *   （有 sourceId 時另以 sourceId 為最優先鍵）。
 *
 * 只做字串正規化與組鍵，不讀資料庫、不寫入。
 */

/** 標準化牌位文字：全形→半形（NFKC）、去除所有空白，供比對用（不改寫顯示值）。 */
export function normalizeTabletText(s: string | null | undefined): string {
  return (s ?? "").normalize("NFKC").replace(/\s+/g, "").trim();
}

export type TabletIdentityInput = {
  category: string;
  displayName?: string | null;
  tabletAddress?: string | null;
  /** 既有來源 ID（worship_records / 既有 entry）。有值時作為最優先鍵。 */
  sourceId?: string | null;
};

/**
 * 產生單一牌位的冪等鍵。
 *
 * 有 sourceId → `<category>::src:<sourceId>`（最穩定）。
 * 否則 → `<category>::name:<正規化名>::addr:<正規化地址>`。
 *
 * ⚠️ 已落地的 UniversalSalvationEntry 目前不持有來源 ID，因此「跨重入」的實際
 * 比對鍵是 name＋addr；sourceId 僅在來源端（options）用以保留不同牌位的區別，
 * 避免同名不同址被提前合併。兩端對同一牌位算出的 name＋addr 鍵一致，故冪等成立。
 */
export function tabletIdentityKey(input: TabletIdentityInput): string {
  const sid = (input.sourceId ?? "").trim();
  if (sid !== "") return `${input.category}::src:${sid}`;
  return `${input.category}::name:${normalizeTabletText(input.displayName)}::addr:${normalizeTabletText(
    input.tabletAddress
  )}`;
}

/** 比對用：兩筆牌位是否為同一牌位（category＋正規化名＋正規化地址皆同）。 */
export function isSameTablet(a: TabletIdentityInput, b: TabletIdentityInput): boolean {
  return (
    a.category === b.category &&
    normalizeTabletText(a.displayName) === normalizeTabletText(b.displayName) &&
    normalizeTabletText(a.tabletAddress) === normalizeTabletText(b.tabletAddress)
  );
}
