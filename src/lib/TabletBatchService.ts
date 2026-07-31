/**
 * V27.10：跨家戶「三個實體紙張／版型批次」的**純函式**服務層（client-safe，不 import Prisma）。
 *
 * 三個列印批次（三批不可互相混印）：
 *   BATCH 1 ancestor-soul：歷代祖先＋乙位正魂＋無緣子女（三區塊牌位，黃色紙，UNIVERSAL_SALVATION_TABLET_A4_V1）
 *   BATCH 2 creditor      ：累世冤親債主（黃色紙，同版型，必須獨立列印）
 *   BATCH 3 pocket        ：寶袋（紅色紙，使用既有寶袋版型，不走本牌位版型）
 *
 * 決策說明（依既有作業流程 + 最小修改）：
 *  - 無緣子女與歷代祖先／乙位正魂同為黃色紙、同一份三區塊版型引擎，故歸入 BATCH 1，
 *    避免資料被漏印；不另建第四批。
 *  - 寶袋（BATCH 3）系統唯一版型在既有「牌位與寶袋列印」流程，本次不重建第二套寶袋版型、
 *    不修改寶袋列印，故 pocket 批次沿用既有流程（見管理頁區塊說明）。
 *
 * 本檔為純函式：輸入已由既有 API（/print-items）取得的清單陣列，輸出分類/彙總/分組結果，
 * 不新增資料表、不改既有牌位版型與 buildTabletLayout。
 */
import type { PrintTabletEntry } from "@/components/ritual/tablets";
import { formatTabletMainText, composeAncestorMainText } from "@/lib/tabletMainText";

// V27.11：re-export 供既有測試/呼叫端沿用同一個共用 formatter（不建立第二套）。
export { composeAncestorMainText };

export type PrintBatchKey = "ancestor-soul" | "creditor" | "pocket";

export type BatchMeta = {
  key: PrintBatchKey;
  /** 區塊標題 */
  label: string;
  /** 一鍵列印主按鈕文字 */
  oneClickLabel: string;
  /** 紙張顏色標示 */
  paperLabel: string;
  /** 紙張色票 className（管理頁色點） */
  paperDotClass: string;
  /** 是否使用本牌位版型引擎（pocket 為 false，走既有寶袋流程） */
  usesTabletEngine: boolean;
  itemType: "TABLET" | "POCKET";
  /** TABLET 批次涵蓋的 sourceCategory */
  categories: string[];
};

export const PRINT_BATCH_META: Record<PrintBatchKey, BatchMeta> = {
  "ancestor-soul": {
    key: "ancestor-soul",
    label: "祖先／乙位正魂",
    oneClickLabel: "一鍵列印全部未列印祖先／乙位",
    paperLabel: "黃色紙",
    paperDotClass: "bg-yellow-300 border border-yellow-500",
    usesTabletEngine: true,
    itemType: "TABLET",
    categories: ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD"],
  },
  creditor: {
    key: "creditor",
    label: "累世冤親債主",
    oneClickLabel: "一鍵列印全部未列印冤親",
    paperLabel: "黃色紙",
    paperDotClass: "bg-yellow-300 border border-yellow-500",
    usesTabletEngine: true,
    itemType: "TABLET",
    categories: ["DEBT_CREDITOR"],
  },
  pocket: {
    key: "pocket",
    label: "寶袋",
    oneClickLabel: "一鍵列印全部未列印寶袋",
    paperLabel: "紅色紙",
    paperDotClass: "bg-red-400 border border-red-600",
    usesTabletEngine: false,
    itemType: "POCKET",
    categories: [],
  },
};

export const BATCH_KEYS: PrintBatchKey[] = ["ancestor-soul", "creditor", "pocket"];

/** 一筆列印物件在此批次系統中屬於哪一批（不屬於任一批回 null）。 */
export function batchOf(item: { itemType: string; sourceCategory: string }): PrintBatchKey | null {
  if (item.itemType === "POCKET") return "pocket";
  if (item.itemType === "TABLET") {
    if (PRINT_BATCH_META.creditor.categories.includes(item.sourceCategory)) return "creditor";
    if (PRINT_BATCH_META["ancestor-soul"].categories.includes(item.sourceCategory)) return "ancestor-soul";
  }
  return null;
}

/** 可列印狀態（排除已取消／待確認）。 */
export function isPrintableStatus(status: string): boolean {
  return status !== "CANCELLED" && status !== "PENDING_CONFIRMATION";
}
/** 未列印＝printCount<=0（與 PrintObjectCenter 的 statusOf 一致）。 */
export function isUnprinted(item: { printCount?: number }): boolean {
  return (item.printCount ?? 0) <= 0;
}
/** 資料完整＝無缺漏欄位（tabletMissingFields 由 gate 同源計算）。 */
export function isComplete(item: { tabletMissingFields?: string[] }): boolean {
  return (item.tabletMissingFields?.length ?? 0) === 0;
}

export type BatchItem = {
  id: string;
  itemType: string;
  sourceCategory: string;
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  sourceLocation: string | null;
  sourceYangshangName: string | null;
  sourceYangshangNames: string[];
  tabletMissingFields: string[];
  status: string;
  printCount: number;
  household: { id: string; name: string };
};

/** 只留該批次、且為可列印狀態的項目。 */
export function filterBatchItems<T extends BatchItem>(items: T[], batch: PrintBatchKey): T[] {
  return items.filter((i) => batchOf(i) === batch && isPrintableStatus(i.status));
}

export type BatchSummary = {
  unprintedTotal: number;
  printableComplete: number;
  incompleteCount: number;
  printedCount: number;
  /** 可正式列印（未列印且完整）的 id 清單。 */
  printableIds: string[];
  /** 缺漏明細：家戶／牌位名稱／缺欄位。 */
  incompleteDetails: { id: string; household: string; name: string; missing: string[] }[];
};

export function summarizeBatchItems(items: BatchItem[], batch: PrintBatchKey): BatchSummary {
  const inBatch = filterBatchItems(items, batch);
  const unprinted = inBatch.filter(isUnprinted);
  const complete = unprinted.filter(isComplete);
  const incomplete = unprinted.filter((i) => !isComplete(i));
  const printed = inBatch.filter((i) => (i.printCount ?? 0) > 0);
  return {
    unprintedTotal: unprinted.length,
    printableComplete: complete.length,
    incompleteCount: incomplete.length,
    printedCount: printed.length,
    printableIds: complete.map((i) => i.id),
    incompleteDetails: incomplete.map((i) => ({
      id: i.id,
      household: `${i.household.name}（${i.household.id}）`,
      name: `${i.sourceCategoryLabel}／${i.sourceDisplayName}`,
      missing: i.tabletMissingFields,
    })),
  };
}

/** 一組 id 是否全屬同一批次：回傳該批次 key，跨批次回 "MIXED"，空/未知回 null。 */
export function classifySelection(items: BatchItem[], ids: Set<string>): PrintBatchKey | "MIXED" | null {
  const batches = new Set<PrintBatchKey>();
  for (const it of items) {
    if (!ids.has(it.id)) continue;
    const b = batchOf(it);
    if (b) batches.add(b);
  }
  if (batches.size === 0) return null;
  if (batches.size > 1) return "MIXED";
  return [...batches][0];
}

export type TabletPrintGroup = { documentType: string; categoryLabel: string; records: PrintTabletEntry[] };

const TABLET_CATEGORY_ORDER = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD", "DEBT_CREDITOR"];

/** 將牌位項目依 documentType 固定順序分組，轉成 UniversalSalvationTabletSheet 需要的 records。 */
export function buildTabletGroups(items: BatchItem[]): TabletPrintGroup[] {
  return TABLET_CATEGORY_ORDER.map((cat) => {
    const rows = items.filter((i) => i.itemType === "TABLET" && i.sourceCategory === cat);
    return {
      documentType: cat,
      categoryLabel: rows[0]?.sourceCategoryLabel ?? cat,
      records: rows.map<PrintTabletEntry>((i) => ({
        // 主文一律走共用 formatter：歷代祖先→○府歷代祖先；其餘不變。
        displayName: formatTabletMainText(cat, i.sourceDisplayName),
        yangshangName: i.sourceYangshangName,
        yangshangNames: i.sourceYangshangNames,
        location: i.sourceLocation,
        notes: null,
      })),
    };
  }).filter((g) => g.records.length > 0);
}
