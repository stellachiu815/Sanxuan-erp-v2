import type { ComponentType } from "react";
import AncestorLineTablet from "./AncestorLineTablet";
import IndividualSoulTablet from "./IndividualSoulTablet";
import DebtCreditorTablet from "./DebtCreditorTablet";
import UnbornChildTablet from "./UnbornChildTablet";
import type { PrintTabletEntry } from "./shared";

export type { PrintTabletEntry, TabletPageLayoutKey } from "./shared";
export {
  TABLET_PAGE_LAYOUTS,
  TABLET_PAGE_LAYOUT_ORDER,
  DEFAULT_TABLET_PAGE_LAYOUT,
  TABLET_FONT_FAMILY,
  A4_PAGE,
} from "./shared";
export { default as PrintSheet } from "./PrintSheet";

type TabletCategoryKey = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR" | "UNBORN_CHILD";

/**
 * 每一類牌位對應各自的列印模板元件（見同資料夾下四個 *Tablet.tsx）。
 *
 * ⚠️ 套版說明：之後三玄宮提供正式牌位設計時，直接替換對應的模板檔案
 * （例如 AncestorLineTablet.tsx）即可自動套用到列印中心／PDF 匯出，
 * 不需要修改這支註冊表或其他任何程式。
 */
export const TABLET_TEMPLATES: Record<
  TabletCategoryKey,
  ComponentType<{ entry: PrintTabletEntry }>
> = {
  ANCESTOR_LINE: AncestorLineTablet,
  INDIVIDUAL_SOUL: IndividualSoulTablet,
  DEBT_CREDITOR: DebtCreditorTablet,
  UNBORN_CHILD: UnbornChildTablet,
};
