// 四種牌位列印模板共用的型別與設定（V4.0 建立，V4.1「正式牌位列印」擴充）。
//
// 每一類牌位（歷代祖先／個人乙位正魂／冤親債主／無緣子女）都各自有自己的
// 模板檔案（見同資料夾下的四個 *Tablet.tsx），方便之後個別調整版面，不會
// 互相牽動；共同的設定（字體、A4 分頁版型）集中寫在這裡。

import { printAddress, printYangshangName } from "@/lib/printChinese";

/**
 * 牌位列印的**原始**資料（資料庫值，阿拉伯數字、不含「叩薦」）。
 */
export type PrintTabletEntry = {
  displayName: string;
  yangshangName: string | null;
  notes: string | null;
  /**
   * V13.1 指令七：牌位地址。可為 null（待補資料）——為 null 時模板不顯示
   * 地址區塊，不會印出空白框或「未填寫」字樣。
   */
  location?: string | null;
};

/**
 * V13.1 指令十二：牌位列印的**已國字化**資料。
 *
 * 四個牌位模板一律渲染這個型別，不再自己碰原始值——這就是指令
 * 「不得在每個模板各寫一套轉換邏輯」的實作方式：轉換只發生在下面
 * toPrintableTablet() 一個地方。
 */
export type PrintableTabletEntry = {
  /** 名稱本身不轉換（是姓名／稱謂，不是數字） */
  displayName: string;
  /**
   * 陽上人：已附加「叩薦」。
   * 空值為空字串，模板據此決定不顯示陽上區塊。
   */
  yangshangText: string;
  /** 牌位地址：門牌數字已轉國字。空值為空字串 */
  locationText: string;
  notes: string | null;
};

/**
 * 原始牌位資料 → 已國字化的列印資料。
 *
 * ⚠️ 這是四個牌位模板取得列印文字的**唯一**管道。
 *
 * 轉換內容：
 *   - 陽上人 → 正規化後附加「叩薦」（printYangshangName）
 *   - 牌位地址 → 門牌數字轉國字（printAddress）
 *   - 名稱 → 不動（姓名不該被轉換）
 *
 * 「叩薦」永遠只在這裡出現，資料庫端絕不儲存（指令六）。
 */
export function toPrintableTablet(entry: PrintTabletEntry): PrintableTabletEntry {
  return {
    displayName: entry.displayName,
    yangshangText: printYangshangName(entry.yangshangName),
    locationText: printAddress(entry.location ?? null),
    notes: entry.notes,
  };
}

/**
 * 牌位文字字體。
 *
 * ⚠️ 之後要換成標楷體時，只需要修改這裡一個地方，四個模板檔案都會一起
 * 套用，不用逐一修改，例如：
 *
 *   export const TABLET_FONT_FAMILY = '"DFKai-SB", "BiauKai", "標楷體", serif';
 */
export const TABLET_FONT_FAMILY =
  '"PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif';

/** A4 紙張尺寸與四周留白，列印跟 PDF 匯出都以此為準，維持所見即所印。 */
export const A4_PAGE = {
  widthMm: 210,
  heightMm: 297,
  marginMm: 12,
} as const;

export type TabletPageLayoutKey = "EIGHT" | "TWELVE" | "SIXTEEN";

/**
 * 每頁 A4 要排幾張牌位（8／12／16 張），以及排成幾欄幾列。
 * 之後如果三玄宮要新增其他張數版型，只需要在這裡新增一筆設定。
 */
export const TABLET_PAGE_LAYOUTS: Record<
  TabletPageLayoutKey,
  { label: string; perPage: number; cols: number; rows: number }
> = {
  EIGHT: { label: "A4／8 張", perPage: 8, cols: 2, rows: 4 },
  TWELVE: { label: "A4／12 張", perPage: 12, cols: 3, rows: 4 },
  SIXTEEN: { label: "A4／16 張", perPage: 16, cols: 4, rows: 4 },
};

export const TABLET_PAGE_LAYOUT_ORDER: TabletPageLayoutKey[] = ["EIGHT", "TWELVE", "SIXTEEN"];

export const DEFAULT_TABLET_PAGE_LAYOUT: TabletPageLayoutKey = "EIGHT";
