/**
 * V9.1「建立附加列印項目與多寶袋管理機制」的純邏輯規則。
 *
 * 刻意獨立成一個不 import Prisma Client 執行期的檔案（只用型別/純函式），
 * 方便在沙盒環境裡直接用 `npx tsx --test tests/*.test.ts` 真的執行測試——
 * 跟 V9.0/V10.0 已經建立的慣例一致（見 purificationNumbering.ts／
 * templeEventNaming.ts／checklistDefaults.ts／importFieldSuggestion.ts）。
 *
 * 這裡處理的都是「跟資料庫無關、純粹是規則」的部分：
 * 1. 列印名稱要「沿用原祭祀名稱」還是「自訂」（需求「五」）。
 * 2. 數量 vs 已列印份數的進度計算，以及補印不得修改原始數量的規則
 *    （需求「六」「十」）。
 * 3. 收費金額計算（需求「十一」）。
 * 4. 依「預設／額外」「狀態」彙總活動摘要數量（需求「十五」）。
 * 5. Excel 匯入方式一（固定欄位）的展開邏輯、方式二（明細工作表）的
 *    欄位驗證與來源比對（需求「八」）——真正查資料庫比對是否找得到來源
 *    資料的部分在 src/lib/additionalPrintItems.ts，這裡只負責純粹的
 *    欄位格式驗證與展開規則。
 */

export type AdditionalPrintItemStatusValue =
  | "PENDING_CONFIRMATION"
  | "PENDING_PRINT"
  | "PRINTED"
  | "CANCELLED";

// ============================================================
// 一、列印名稱規則（需求「五」）
// ============================================================

/**
 * 決定列印名稱：usesSourceName=true 時沿用原祭祀名稱，否則使用自訂名稱。
 * 自訂名稱是空字串時（理論上 API 層會先擋掉，這裡是最後一道保險），退回
 * 使用原祭祀名稱，避免存進一個空白的列印名稱。
 */
export function resolvePrintName(
  usesSourceName: boolean,
  sourceName: string,
  customName?: string | null
): string {
  const trimmedSource = sourceName.trim();
  if (usesSourceName) return trimmedSource;
  const trimmedCustom = (customName ?? "").trim();
  return trimmedCustom || trimmedSource;
}

// ============================================================
// 二、數量與列印進度規則（需求「六」「十」）
// ============================================================

export type PrintProgress = {
  /** 這個項目的 quantity 是否已經完整列印過（printedQuantity >= quantity）。 */
  isFullyPrinted: boolean;
  /** 距離「印滿 quantity 份」還差幾份。 */
  remaining: number;
};

/** 若 quantity 為 2，需能知道本次是否已完整列印兩份（需求「十」）。 */
export function computePrintProgress(quantity: number, printedQuantity: number): PrintProgress {
  const remaining = Math.max(0, quantity - printedQuantity);
  return { isFullyPrinted: printedQuantity >= quantity, remaining };
}

export type PrintActionState = {
  quantity: number;
  printedQuantity: number;
  reprintCount: number;
  isPrinted: boolean;
};

/**
 * 執行一次列印動作（第一次列印或補印）後的新狀態。
 *
 * 需求「十」明確要求：補印不得修改原始數量（quantity 永遠不變），只新增
 * 補印紀錄——第一次列印會把 printedQuantity 設成這次印的份數（一般就是
 * quantity 本身，一次印滿）；已經列印過之後再次列印（補印）一律只會讓
 * printedQuantity／reprintCount 往上累加，quantity 完全不受影響。
 */
export function applyPrintAction(
  current: PrintActionState,
  copiesPrinted: number
): PrintActionState {
  const safeCopies = Math.max(0, Math.floor(copiesPrinted));
  if (!current.isPrinted) {
    return {
      quantity: current.quantity,
      printedQuantity: safeCopies,
      reprintCount: current.reprintCount,
      isPrinted: true,
    };
  }
  return {
    quantity: current.quantity,
    printedQuantity: current.printedQuantity + safeCopies,
    reprintCount: current.reprintCount + 1,
    isPrinted: true,
  };
}

// ============================================================
// 二之二、V14.4 列印物件層：首印／補印次數與時間戳規則（指令二）
// ============================================================
//
// 每個列印物件（TABLET 牌位／POCKET 寶袋…）各自保存 printCount 與三個時間戳。
// 語意固定：printCount=0 未列印；=1 首次列印；>1 已補印 printCount-1 次。
// firstPrintedAt 一旦設定永不覆蓋；lastPrintedAt / lastPrintedByUserId 每次更新。
// 補印只影響列印紀錄，不動報名／應收／收款（真正寫庫在 service 層，這裡是純規則）。

export type PrintObjectState = {
  printCount: number;
  firstPrintedAt: Date | null;
  lastPrintedAt: Date | null;
  lastPrintedByUserId: string | null;
};

export type PrintObjectStatus = "UNPRINTED" | "PRINTED" | "REPRINTED";

/** printCount → 狀態：0 未列印、1 已列印、>1 已補印。 */
export function printObjectStatus(printCount: number): PrintObjectStatus {
  if (printCount <= 0) return "UNPRINTED";
  if (printCount === 1) return "PRINTED";
  return "REPRINTED";
}

/** 已補印次數＝printCount-1（未列印或首印為 0）。 */
export function reprintTimes(printCount: number): number {
  return Math.max(0, printCount - 1);
}

/**
 * 對單一列印物件套用「一次列印」（首印或補印）後的新狀態。
 * - 首印（printCount=0）：printCount→1、設 firstPrintedAt＝lastPrintedAt＝at、記操作帳號。
 * - 補印（printCount>0）：printCount+1、**firstPrintedAt 保留不覆蓋**、更新 lastPrintedAt 與操作帳號。
 * at 由伺服器產生、byUserId 一律來自 session（呼叫端保證），這裡不接受前端傳入身分。
 */
export function applyPrintToObject(
  current: PrintObjectState,
  at: Date,
  byUserId: string
): PrintObjectState {
  const isFirstPrint = current.printCount <= 0;
  return {
    printCount: Math.max(0, current.printCount) + 1,
    firstPrintedAt: isFirstPrint ? at : current.firstPrintedAt,
    lastPrintedAt: at,
    lastPrintedByUserId: byUserId,
  };
}

// ============================================================
// 三、收款與費用規則（需求「十一」）
// ============================================================

export type FeeCalculation = {
  /** null 代表「應該收費但單價尚未設定」，需要人工補齊，不能直接當作 0。 */
  subtotal: number | null;
};

/**
 * 目前若三玄宮不另外收費，isChargeable=false 時小計固定是 0（需求
 * 「十一」：可預設為零元，但資料架構要保留未來設定收費的能力）。
 * isChargeable=true 但還沒設定單價時，回傳 null（不能假裝是 0，需要
 * 畫面提示人工補齊單價）。
 */
export function computeAdditionalPrintItemFee(
  isChargeable: boolean,
  unitPrice: number | null | undefined,
  quantity: number
): FeeCalculation {
  if (!isChargeable) return { subtotal: 0 };
  if (unitPrice === null || unitPrice === undefined) return { subtotal: null };
  return { subtotal: Math.round(unitPrice * quantity * 100) / 100 };
}

// ============================================================
// 四、活動摘要彙總（需求「十五」）
// ============================================================

export type PrintItemSummaryInput = { isExtra: boolean; status: AdditionalPrintItemStatusValue };

export type PrintItemSummary = {
  defaultCount: number;
  extraCount: number;
  total: number;
  pendingPrintCount: number;
  printedCount: number;
  cancelledCount: number;
};

/**
 * 依「預設／額外」「狀態」彙總活動摘要（需求「十五」：預設寶袋數量／
 * 額外寶袋數量／寶袋總數／待列印數量／已列印數量）。已取消的項目不計入
 * 「總數」（total），但仍然單獨回報 cancelledCount，供畫面上另外顯示，
 * 不會讓已取消的項目悄悄消失在統計數字裡。
 */
export function summarizePrintItems(items: PrintItemSummaryInput[]): PrintItemSummary {
  let defaultCount = 0;
  let extraCount = 0;
  let pendingPrintCount = 0;
  let printedCount = 0;
  let cancelledCount = 0;

  for (const item of items) {
    if (item.status === "CANCELLED") {
      cancelledCount++;
      continue;
    }
    if (item.isExtra) extraCount++;
    else defaultCount++;

    if (item.status === "PRINTED") printedCount++;
    else pendingPrintCount++; // PENDING_CONFIRMATION 與 PENDING_PRINT 都算「還沒印」
  }

  return {
    defaultCount,
    extraCount,
    total: defaultCount + extraCount,
    pendingPrintCount,
    printedCount,
    cancelledCount,
  };
}

// ============================================================
// 五、Excel 匯入方式一：固定欄位展開（需求「八」方式一）
// ============================================================

export type FixedColumnImportRow = {
  defaultBagName?: string | null;
  extra1Name?: string | null;
  extra1Quantity?: number | null;
  extra2Name?: string | null;
  extra2Quantity?: number | null;
};

export type ExpandedBagSpec = { printName: string; quantity: number; isExtra: boolean };

/**
 * 把「固定欄位」（預設寶袋／額外寶袋一名稱＋數量／額外寶袋二名稱＋數量）
 * 展開成獨立的寶袋規格陣列——即使兩個額外寶袋名稱相同，也會展開成兩筆
 * 獨立資料，不會合併成一筆「數量加總」（需求「六」：兩個寶袋名稱不同，
 * 必須建立兩筆獨立資料，不可只用總數表示；名稱相同時系統仍然視為使用者
 * 刻意分開輸入的兩筆，原樣展開，不自作主張合併）。
 */
export function expandFixedColumnRow(row: FixedColumnImportRow): ExpandedBagSpec[] {
  const specs: ExpandedBagSpec[] = [];

  const defaultName = (row.defaultBagName ?? "").trim();
  if (defaultName) {
    specs.push({ printName: defaultName, quantity: 1, isExtra: false });
  }

  const extra1Name = (row.extra1Name ?? "").trim();
  if (extra1Name) {
    const qty = row.extra1Quantity && row.extra1Quantity > 0 ? Math.floor(row.extra1Quantity) : 1;
    specs.push({ printName: extra1Name, quantity: qty, isExtra: true });
  }

  const extra2Name = (row.extra2Name ?? "").trim();
  if (extra2Name) {
    const qty = row.extra2Quantity && row.extra2Quantity > 0 ? Math.floor(row.extra2Quantity) : 1;
    specs.push({ printName: extra2Name, quantity: qty, isExtra: true });
  }

  return specs;
}

// ============================================================
// 六、Excel 匯入方式二：明細工作表列驗證與來源比對（需求「八」方式二）
// ============================================================

export type DetailSheetImportRow = {
  householdId?: string | null;
  sourceCategory?: string | null;
  sourceName?: string | null;
  itemType?: string | null;
  printName?: string | null;
  quantity?: unknown;
  note?: string | null;
};

export type DetailSheetRowValidation = { ok: boolean; issues: string[] };

const VALID_ITEM_TYPES = new Set(["POCKET", "TABLET", "PETITION", "LANTERN_TABLET", "OTHER"]);
const VALID_SOURCE_CATEGORIES = new Set([
  "ANCESTOR_LINE",
  "INDIVIDUAL_SOUL",
  "DEBT_CREDITOR",
  "UNBORN_CHILD",
]);

/**
 * 明細工作表每一列的欄位格式驗證（不查資料庫，純粹檢查欄位本身是否完整/
 * 格式正確）。找不找得到對應的來源資料（歷代祖先/冤親/乙位正魂/無緣子女
 * 是否真的存在），是 src/lib/additionalPrintItems.ts 另外查資料庫比對的
 * 部分，這裡只負責「資料本身有沒有寫齊」。
 */
export function validateDetailSheetImportRow(row: DetailSheetImportRow): DetailSheetRowValidation {
  const issues: string[] = [];

  if (!(row.householdId ?? "").toString().trim()) issues.push("缺少家戶編號");
  if (!(row.sourceCategory ?? "").toString().trim()) {
    issues.push("缺少原祭祀類型");
  } else if (!VALID_SOURCE_CATEGORIES.has(String(row.sourceCategory).trim())) {
    issues.push("原祭祀類型不是「歷代祖先／個人乙位正魂／冤親債主／無緣子女」其中一種");
  }
  if (!(row.sourceName ?? "").toString().trim()) issues.push("缺少原祭祀名稱");
  if (!(row.itemType ?? "").toString().trim()) {
    issues.push("缺少附加項目類型");
  } else if (!VALID_ITEM_TYPES.has(String(row.itemType).trim())) {
    issues.push("附加項目類型不是「寶袋／牌位／疏文／燈牌／其他列印項目」其中一種");
  }
  if (!(row.printName ?? "").toString().trim()) issues.push("缺少列印名稱");

  const quantityNumber = Number(row.quantity);
  if (row.quantity === undefined || row.quantity === null || row.quantity === "") {
    // 沒填數量視為 1，不算錯誤（多數列都不會特別填數量欄位）。
  } else if (!Number.isInteger(quantityNumber) || quantityNumber < 1) {
    issues.push("數量必須是至少 1 的整數");
  }

  return { ok: issues.length === 0, issues };
}

/** 明細工作表列的數量欄位，沒填或格式錯誤時一律視為 1。 */
export function resolveDetailSheetQuantity(quantity: unknown): number {
  const n = Number(quantity);
  return Number.isInteger(n) && n >= 1 ? n : 1;
}

/**
 * 比對「來源祭祀項目」是否存在：家戶底下同一年度普渡登記的某個分類
 * （category）裡，有沒有一筆 displayName 完全相符（去除頭尾空白後比對）
 * 的登記項目。找不到時，呼叫端（src/lib/additionalPrintItems.ts）要把
 * 這一列列入「待確認」，不得直接匯入（需求「八」）。
 */
export function matchesSourceEntry(
  entry: { category: string; displayName: string },
  row: { sourceCategory: string; sourceName: string }
): boolean {
  return (
    entry.category === row.sourceCategory.trim() &&
    entry.displayName.trim() === row.sourceName.trim()
  );
}
