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
import { printNumberOf } from "@/lib/workOrder";

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
    // V30.3：寶袋改走同一 A4 引擎（POCKET documentType，既定 25×140／45×60／25×65mm、每頁 4 筆），
    // 不再只顯示 Notice。祖先／乙位正魂／無緣子女／冤親四種牌位版面完全不受影響。
    usesTabletEngine: true,
    itemType: "POCKET",
    categories: [],
  },
};

export const BATCH_KEYS: PrintBatchKey[] = ["ancestor-soul", "creditor", "pocket"];

/**
 * V30.3 資料鏈防誤取：列印中心「順序／作業號碼」的 registrationOrder 只能對 **TABLET（牌位）**
 * 取其 sourceEntry（UniversalSalvationEntry）對應報名項目的順序。
 *
 * POCKET（寶袋）的 `sourceEntryId` 指向的是它「所依附的牌位」entry（歷代祖先／乙位正魂／
 * 累世冤親債主／無緣子女）。若沿用同一條 `universalSalvationEntryId = sourceEntryId` join，
 * 會把**牌位的 registrationOrder 誤植到寶袋**（例：祖先 No.003 被印在寶袋上）。
 *
 * 目前資料模型中，寶袋 AdditionalPrintItem **沒有**回指自身 US_POCKET_EXTRA
 * RitualRegistrationItem 的欄位（AdditionalPrintItem 無 registrationItemId；
 * linkItemToExistingDetail 亦不為 POCKET 設定 linkedEntryId），因此**無法**、也**不得**由
 * 依附牌位取號。規則：
 *   - TABLET → 使用其牌位報名項目的 registrationOrder（可為 null）。
 *   - 非 TABLET（POCKET…）→ 一律 null（寶袋自身無順序連結時維持 null，**絕不** fallback 牌位號碼）。
 *
 * 未來若建立「寶袋自身 US_POCKET_EXTRA 報名項目 → 列印物件」的正式連結，只需把非 TABLET 分支
 * 改由該自身項目取號，牌位分支與其他資料鏈皆不受影響。（放在 client-safe 純函式層便於單元測試。）
 */
export function registrationOrderForPrintItem(
  itemType: string,
  entryRegistrationOrder: number | null
): number | null {
  return itemType === "TABLET" ? entryRegistrationOrder : null;
}

/**
 * V30.3b 寶袋作業號碼資料鏈的**唯一** repository-mapping 規則（純函式，client-safe，便於單元測試；
 * listPrintItemsForPrintCenter 直接呼叫本函式，測試涵蓋即等同涵蓋正式查詢路徑）。
 *
 *   TABLET（牌位）→ 由 sourceEntry（UniversalSalvationEntry）對應報名項目取 registrationOrder。
 *   POCKET（寶袋）→ **只**由自身 `registrationItemId` → RitualRegistrationItem 取號，且該報名
 *                    項目型別必須為 US_POCKET_EXTRA；否則（無關聯／找不到／型別不符／order 為 null）
 *                    一律回 null。**絕不** fallback 到 sourceEntry（依附牌位：祖先／乙位／冤親／無緣）。
 *
 * @param item.registrationItemId 寶袋自身 US_POCKET_EXTRA 報名項目 id（基本寶袋／未回填為 null）。
 * @param ctx.tabletOrderByEntryId  TABLET 用：entryId → registrationOrder。
 * @param ctx.pocketRegistrationById POCKET 用：registrationItemId → { itemKey, registrationOrder }。
 */
export function resolvePrintItemRegistrationOrder(
  item: { itemType: string; sourceEntryId: string; registrationItemId: string | null },
  ctx: {
    tabletOrderByEntryId: Map<string, number | null>;
    pocketRegistrationById: Map<string, { itemKey: string; registrationOrder: number | null }>;
  }
): number | null {
  if (item.itemType === "TABLET") {
    return ctx.tabletOrderByEntryId.get(item.sourceEntryId) ?? null;
  }
  // 非 TABLET（POCKET…）：只認自身報名識別關聯，且必須 US_POCKET_EXTRA。
  if (!item.registrationItemId) return null;
  const reg = ctx.pocketRegistrationById.get(item.registrationItemId);
  if (!reg) return null; // 關聯指向的報名項目不存在／已刪除
  if (reg.itemKey !== "US_POCKET_EXTRA") return null; // 型別守門：非增加寶袋不顯示號碼
  return reg.registrationOrder ?? null; // 自身順序 null → 維持 null（不 fallback 牌位）
}

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

/**
 * V34.3B：列印物件的「來源牌位／報名項目」是否應被排除（不進列印清單）。
 * 純函式（client-safe，供 listPrintItemsForPrintCenter 與單元測試共用）。
 * 一律排除：來源牌位查無／已封存（deletedAt）、或其 1:1 報名項目已刪除／狀態 CANCELLED。
 * TABLET 與 POCKET 都以其 sourceEntry（POCKET 的 sourceEntry＝所依附牌位）判斷。
 */
export function shouldExcludeLeakedPrintSource(input: {
  sourceExists: boolean;
  sourceDeletedAt?: Date | string | null;
  registrationItemStatus?: string | null;
  registrationItemDeleted?: boolean;
}): boolean {
  if (!input.sourceExists) return true; // 查無（含查詢已用 deletedAt:null 濾掉的封存牌位）
  if (input.sourceDeletedAt) return true; // 防禦：來源牌位已封存
  if (input.registrationItemDeleted) return true; // 關聯報名項目已刪除
  if (input.registrationItemStatus === "CANCELLED") return true; // 關聯報名項目已取消
  return false;
}

export type BatchItem = {
  id: string;
  /** V30.3 建立順序（歷史查核；未補號為 null）。 */
  registrationOrder?: number | null;
  /** V31 正式作業號（列印 No.xxx 一律用此；未指派時回退 registrationOrder）。 */
  workOrder?: number | null;
  itemType: string;
  sourceCategory: string;
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  /** V32 單筆列印主文覆寫；有值時列印引擎直接採用（不套 formatter）。 */
  printMainText?: string | null;
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

/**
 * V32 阻擋修正（冤親等牌位重複）：列印物件層唯一性保證。
 *
 * 不變式：一個 UniversalSalvationEntry（sourceEntryId）的**預設**列印物件（isExtra=false）
 * 每種 itemType 只會有一個（TABLET 一個、基本 POCKET 一個）。DB 已有 partial unique index
 * 保障，但若正式資料庫存在早於該 index 的遺留重複列，或任何邊界情況產生重複列，
 * 讀取端仍可能把同一冤親牌位列出兩次、正式列印印兩張。
 *
 * 本函式在**資料查詢輸出**就地去重（不只修畫面）：同一 (sourceEntryId, itemType) 的預設物件
 * 只保留一筆——優先保留已有列印紀錄者（printCount 最大），其次建立較早（createdAt 最早、id 最小），
 * 確保列印狀態不遺失。額外寶袋（isExtra=true）可多筆，不受影響。純函式、可測試。
 */
export function dedupeDefaultPrintObjects<
  T extends { id: string; sourceEntryId: string; itemType: string; isExtra: boolean; printCount?: number; createdAt?: Date | string | null }
>(items: T[]): T[] {
  const bestByKey = new Map<string, T>();
  const passthrough: T[] = [];
  const order: string[] = [];
  const time = (v: Date | string | null | undefined): number => {
    if (!v) return Number.POSITIVE_INFINITY; // 無 createdAt 視為最晚（不優先保留）
    const t = new Date(v).getTime();
    return Number.isNaN(t) ? Number.POSITIVE_INFINITY : t;
  };
  const better = (a: T, b: T): T => {
    // printCount 大者優先（保留列印紀錄）；再比 createdAt 早；再比 id 小（穩定）。
    const pa = a.printCount ?? 0, pb = b.printCount ?? 0;
    if (pa !== pb) return pa > pb ? a : b;
    const ta = time(a.createdAt), tb = time(b.createdAt);
    if (ta !== tb) return ta < tb ? a : b;
    return a.id <= b.id ? a : b;
  };
  for (const it of items) {
    if (it.isExtra) { passthrough.push(it); continue; }
    const key = `${it.sourceEntryId}::${it.itemType}`;
    const cur = bestByKey.get(key);
    if (!cur) { bestByKey.set(key, it); order.push(key); }
    else bestByKey.set(key, better(cur, it));
  }
  // 維持原本相對出現順序（以各 key 首次出現為序），再接額外物件。
  const deduped = order.map((k) => bestByKey.get(k)!).filter(Boolean) as T[];
  return [...deduped, ...passthrough];
}

/**
 * V33 §9 診斷／修復用：找出**應被視為重複、可安全去除**的預設列印物件 id。
 * 對同一 (sourceEntryId, itemType) 的預設物件（isExtra=false、未刪除），保留一筆（同 dedupe 規則），
 * 其餘回報為「移除候選」。額外寶袋（isExtra=true）永不列入。純函式（供 dry-run 腳本與測試共用）。
 * 回傳每組：{ sourceEntryId, itemType, keepId, removeIds }。
 */
export function duplicateDefaultPrintObjects<
  T extends { id: string; sourceEntryId: string; itemType: string; isExtra: boolean; printCount?: number; createdAt?: Date | string | null }
>(items: T[]): { sourceEntryId: string; itemType: string; keepId: string; removeIds: string[] }[] {
  const groups = new Map<string, T[]>();
  for (const it of items) {
    if (it.isExtra) continue;
    const key = `${it.sourceEntryId}::${it.itemType}`;
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(it);
  }
  const out: { sourceEntryId: string; itemType: string; keepId: string; removeIds: string[] }[] = [];
  for (const [, list] of groups) {
    if (list.length <= 1) continue; // 無重複
    const kept = dedupeDefaultPrintObjects(list)[0];
    out.push({
      sourceEntryId: list[0].sourceEntryId,
      itemType: list[0].itemType,
      keepId: kept.id,
      removeIds: list.filter((x) => x.id !== kept.id).map((x) => x.id),
    });
  }
  return out;
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

/** 三區塊型（共用同一份 3-block 版面，可同頁混排）。 */
const THREE_BLOCK_CATS = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD"];

function toRecord(i: BatchItem): PrintTabletEntry {
  return {
    // V32：有單筆列印主文覆寫（printMainText）時直接採用（不套 formatter，例：本宅地基主）；
    // 否則走共用 formatter：歷代祖先→○府歷代祖先；乙位正魂／無緣子女／冤親不變。
    displayName: (i.printMainText ?? "").trim() || formatTabletMainText(i.sourceCategory, i.sourceDisplayName),
    yangshangName: i.sourceYangshangName,
    yangshangNames: i.sourceYangshangNames,
    location: i.sourceLocation,
    notes: null,
    // V31：作業號碼＝正式作業號 workOrder（未指派時安全回退 registrationOrder）；列印於裁切外白邊。
    workNumber: printNumberOf(i.workOrder, i.registrationOrder),
  };
}

/**
 * 轉成 UniversalSalvationTabletSheet 需要的分組。
 *
 * V27.14：**依「版面類型」分組，不依精確 documentType**——歷代祖先／乙位正魂／無緣子女
 * 都是同一份 3-block 版面（THREE_BLOCK_SLOTS、5/頁、相同尺寸），合併成**同一組**，才能在每頁
 * 5 格內把多筆一起排；documentType 用代表值 ANCESTOR_LINE（三型 slots/尺寸完全相同）。冤親債主
 * （2-block、11/頁）另成一組。這樣 scope=unprinted 與 ids 兩條流程走**完全相同**的 page grouping，
 * 選 N 筆（含混合型別）就在同一份 layout 裡一起排，不會每筆各自重建 page。順序：3-block 依
 * 歷代祖先→乙位正魂→無緣子女，其後冤親。
 */
export function buildTabletGroups(items: BatchItem[]): TabletPrintGroup[] {
  const tablets = items.filter((i) => i.itemType === "TABLET");
  const threeBlock = THREE_BLOCK_CATS.flatMap((cat) => tablets.filter((i) => i.sourceCategory === cat)).map(toRecord);
  const debt = tablets.filter((i) => i.sourceCategory === "DEBT_CREDITOR").map(toRecord);
  // V30.3：寶袋（itemType POCKET）→ POCKET 版面（同一 A4 引擎）。傳入前已依 registrationOrder 排序（NULL 最後）。
  const pockets = items.filter((i) => i.itemType === "POCKET").map(toRecord);

  const groups: TabletPrintGroup[] = [];
  if (threeBlock.length > 0) {
    groups.push({ documentType: "ANCESTOR_LINE", categoryLabel: "祖先／乙位正魂／無緣子女", records: threeBlock });
  }
  if (debt.length > 0) {
    groups.push({ documentType: "DEBT_CREDITOR", categoryLabel: "累世冤親債主", records: debt });
  }
  if (pockets.length > 0) {
    groups.push({ documentType: "POCKET", categoryLabel: "寶袋", records: pockets });
  }
  return groups;
}
