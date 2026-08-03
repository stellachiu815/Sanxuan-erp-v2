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

// V13.1：年度燈燈牌與疏文。與四種牌位模板一樣，只負責排版，
// 所有國字轉換都在 src/lib/lanternPrint.ts 完成後才傳進來。
export { default as LanternTablet } from "./LanternTablet";
export type { LanternTabletProps } from "./LanternTablet";
export { default as PetitionSheet } from "./PetitionSheet";
export { toPrintableTablet } from "./shared";
export type { PrintableTabletEntry } from "./shared";

// UNIVERSAL_SALVATION_TABLET_A4_V1：四種牌位共用的單一 A4 版面引擎與渲染元件
// （固定 5／11 筆、3mm 邊界、offset、驗證）。舊四支 *Tablet.tsx 暫不移除（驗收後再淘汰）。
export { default as UniversalSalvationTabletSheet } from "./UniversalSalvationTabletSheet";
export type { TabletSheetMode, TabletTemplateStyle } from "./UniversalSalvationTabletSheet";
export {
  TABLET_A4_TEMPLATE_ID,
  TABLET_A4_CONFIG,
  SLOTS_PER_PAGE,
  DOCUMENT_BLOCKS,
  BLOCK_SIZE,
  buildTabletLayout,
  buildAutoTabletLayout,
  validateLayout,
  isOffsetWithinBounds,
  pageIndexOf,
  slotIndexOf,
} from "./universalSalvationTabletA4";
export type {
  TabletDocumentType,
  TabletBlockType,
  TabletA4Offset,
  TabletRecordInput,
  PositionedBlock,
  TabletLayout,
  TabletPackingInfo,
  AutoLayoutOptions,
  LayoutViolation,
} from "./universalSalvationTabletA4";

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
