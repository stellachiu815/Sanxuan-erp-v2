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
export const STICKER_A4_PAGE = {
  widthMm: 210,
  heightMm: 297,
  /** 紙張四周留白（不列印區域，對應「裁切位置固定」的安全邊界）。 */
  marginMm: 8,
  /** 每格之間的間距，可調整項目之一（需求「八」：格距可調整）。 */
  gapMm: 2,
  cols: 3,
  rows: 11,
  perPage: 33,
} as const;

/** className「sticker-print-sheet」是 PDF 匯出尋找每一頁的依據，跟牌位列印同慣例，請勿更改。 */
export const STICKER_SHEET_CLASS = "sticker-print-sheet";
