/**
 * A4 小人頭貼紙的實體版面設定（需求「八」：固定 A4、每張 33 格、3欄×11列）。
 *
 * ⚠️ 目前沒有拿到官方「113小人頭1-33」Word 範本檔案，這裡的紙張留白／
 * 格距是合理預設值，不是官方正式規格（同 src/lib/purificationLayout.ts
 * 開頭的說明）。之後範本檔案送到後，只需要調整這裡的數字，畫面/PDF會
 * 自動套用新的留白與格距，不需要重寫排版元件本身——3欄×11列＝33格、
 * 直式右到左的排版方式，以及編號橫式嵌字的做法，是需求明確要求固定
 * 不變的部分，不會因為範本而改變。
 *
 * ⚠️ 檔名修正說明（本輪 build 修正）：這個檔案原本叫 stickerSheet.ts，
 * 跟同目錄的元件 StickerSheet.tsx 只差在檔名大小寫。這在 Linux／Git／
 * Render 這類「大小寫敏感」檔案系統上完全沒問題，但 macOS 預設的 APFS
 * 是「大小寫不敏感」，`StickerSheet.tsx` 跟 `stickerSheet.ts` 在磁碟上
 * 會被當成同一個檔案，導致其中一個檔案的內容蓋掉另一個，`import from
 * "./stickerSheet"` 實際上讀到的內容變成不可預期——這正是這次本機
 * `yarn build` 失敗的根本原因。改名成 stickerSheetLayout.ts，跟
 * StickerSheet.tsx 不會再有任何大小寫層級的衝突，兩個檔案在任何檔案
 * 系統上都能穩定共存。純粹改名＋修正 import，沒有改動任何數值或版型。
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
