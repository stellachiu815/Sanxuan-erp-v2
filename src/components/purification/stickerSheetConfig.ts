/**
 * A4 小人頭貼紙的實體版面設定（需求「八」：固定 A4、每張 33 格、3欄×11列）。
 *
 * ⚠️ 目前沒有拿到官方「113小人頭1-33」Word 範本檔案，這裡的紙張留白／
 * 格距是合理預設值，不是官方正式規格（同 src/lib/purificationLayout.ts
 * 開頭的說明）。之後範本檔案送到後，只需要調整這裡的數字，畫面/PDF會
 * 自動套用新的留白與格距，不需要重寫排版元件本身——3欄×11列＝33格、
 * 直式右到左的排版方式，以及編號橫式嵌字的做法，是需求明確要求固定
 * 不變的部分，不會因為範本而改變。
 */
// Stella 定案：每格 7cm × 2.7cm（70×27mm）、3欄×11列＝33格，剛好鋪滿整張 A4
// （70×3＝210、27×11＝297），故四周留白與格距皆為 0；若實體標籤產品有邊界再於此微調。
export const STICKER_A4_PAGE = {
  widthMm: 210,
  heightMm: 297,
  /** 紙張四周留白（0：貼紙鋪滿整張 A4）。 */
  marginMm: 0,
  /** 每格之間的間距（0：貼紙相鄰無縫）。 */
  gapMm: 0,
  cols: 3,
  rows: 11,
  perPage: 33,
  /** 每格實體尺寸（供對照／校準）：7cm × 2.7cm。 */
  cellWidthMm: 70,
  cellHeightMm: 27,
} as const;

/** className「sticker-print-sheet」是 PDF 匯出尋找每一頁的依據，跟牌位列印同慣例，請勿更改。 */
export const STICKER_SHEET_CLASS = "sticker-print-sheet";
