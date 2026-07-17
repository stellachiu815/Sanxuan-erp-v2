import { AdditionalPrintItemType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { universalSalvationEntryCategoryLabel } from "@/lib/labels";
import {
  resolvePrintName,
  computeAdditionalPrintItemFee,
  applyPrintAction,
  summarizePrintItems,
  matchesSourceEntry,
  resolveDetailSheetQuantity,
  type AdditionalPrintItemStatusValue,
} from "@/lib/additionalPrintItemRules";

/**
 * V9.1「建立附加列印項目與多寶袋管理機制」核心業務邏輯。
 *
 * 對應需求「一～十五」：每一個寶袋（或牌位/疏文/燈牌/其他列印項目）都是
 * 一筆獨立的 AdditionalPrintItem，掛在既有的普渡登記項目
 * （UniversalSalvationEntry：歷代祖先/個人乙位正魂/冤親債主/無緣子女）
 * 底下，可以各自設定列印名稱、數量、狀態、模板，不會被簡化成一個數字或
 * 一個布林值。純規則（列印名稱決定、數量進度、費用計算、統計彙總）都在
 * src/lib/additionalPrintItemRules.ts（不碰資料庫，可在沙盒真正測試），
 * 這裡負責串接 Prisma、recordVersion（版本紀錄）與既有的普渡登記資料。
 */

type EntryContext = {
  entry: {
    id: string;
    category: string;
    displayName: string;
    deletedAt: Date | null;
  };
  ritualRecordId: string;
  householdId: string;
  year: number;
  templeEventId: string | null;
};

/** 從一筆普渡登記項目（UniversalSalvationEntry）往上找到它所屬的家戶/年度/活動主檔。 */
async function resolveEntryContext(entryId: string): Promise<EntryContext | null> {
  const entry = await prisma.universalSalvationEntry.findUnique({
    where: { id: entryId },
    include: {
      universalSalvation: { include: { ritualRecord: true } },
    },
  });
  if (!entry || entry.deletedAt) return null;
  const ritualRecord = entry.universalSalvation.ritualRecord;
  if (!ritualRecord || ritualRecord.deletedAt) return null;

  return {
    entry: {
      id: entry.id,
      category: entry.category,
      displayName: entry.displayName,
      deletedAt: entry.deletedAt,
    },
    ritualRecordId: ritualRecord.id,
    householdId: ritualRecord.householdId,
    year: ritualRecord.year,
    templeEventId: ritualRecord.templeEventId,
  };
}

export type AdditionalPrintItemMutationResult =
  | { ok: true; item: Awaited<ReturnType<typeof prisma.additionalPrintItem.findUniqueOrThrow>> }
  | { ok: false; status: number; error: string };

export type AdditionalPrintItemListResult =
  | {
      ok: true;
      items: Awaited<ReturnType<typeof prisma.additionalPrintItem.findMany>>;
    }
  | { ok: false; status: number; error: string };

/** 列出某一筆普渡登記項目（entryId）底下所有附加列印項目（含已取消，排除已永久刪除的）。 */
export async function listAdditionalPrintItemsForEntry(
  householdId: string,
  year: number,
  entryId: string
): Promise<AdditionalPrintItemListResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }

  const items = await prisma.additionalPrintItem.findMany({
    where: { sourceEntryId: entryId, deletedAt: null },
    orderBy: [{ isExtra: "asc" }, { createdAt: "asc" }],
  });
  return { ok: true, items };
}

export type CreateAdditionalPrintItemInput = {
  itemType: AdditionalPrintItemType;
  usesSourceName: boolean;
  customPrintName?: string | null;
  quantity: number;
  isExtra: boolean;
  templateId?: string | null;
  note?: string | null;
  isChargeable?: boolean;
  unitPrice?: number | null;
  status?: AdditionalPrintItemStatusValue;
};

/**
 * 新增一筆附加列印項目（需求「四、＋新增寶袋」）。usesSourceName=true 時
 * 自動沿用原祭祀名稱（entry.displayName），=false 時使用 customPrintName；
 * 兩者算出來的列印名稱一律存成獨立欄位，之後原祭祀名稱異動不會回頭影響
 * 已經建立的列印名稱（需求「五」，見 resolvePrintName() 說明）。
 */
export async function createAdditionalPrintItem(
  householdId: string,
  year: number,
  entryId: string,
  input: CreateAdditionalPrintItemInput,
  operatorName?: string | null
): Promise<AdditionalPrintItemMutationResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }

  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, status: 400, error: "數量必須是至少 1 的整數" };
  }

  const printName = resolvePrintName(input.usesSourceName, context.entry.displayName, input.customPrintName);
  if (!printName) {
    return { ok: false, status: 400, error: "請輸入寶袋列印名稱" };
  }

  const fee = computeAdditionalPrintItemFee(Boolean(input.isChargeable), input.unitPrice ?? null, input.quantity);

  const created = await prisma.$transaction(async (tx) => {
    const item = await tx.additionalPrintItem.create({
      data: {
        activityId: context.templeEventId,
        ritualRecordId: context.ritualRecordId,
        sourceEntryId: entryId,
        sourceEntryType: "UNIVERSAL_SALVATION_ENTRY",
        householdId,
        itemType: input.itemType,
        printName,
        usesSourceName: input.usesSourceName,
        quantity: input.quantity,
        templateId: input.templateId ?? null,
        status: input.status ?? "PENDING_PRINT",
        note: input.note ?? null,
        isExtra: input.isExtra,
        isChargeable: Boolean(input.isChargeable),
        unitPrice: input.unitPrice ?? null,
        subtotal: fee.subtotal,
        createdBy: operatorName?.trim() || null,
      },
    });

    await recordVersion(
      { entityType: "AdditionalPrintItem", entityId: item.id, action: "CREATE", afterData: item, operatorName },
      tx
    );

    return item;
  });

  return { ok: true, item: created };
}

export type UpdateAdditionalPrintItemInput = {
  itemType?: AdditionalPrintItemType;
  usesSourceName?: boolean;
  customPrintName?: string | null;
  quantity?: number;
  isExtra?: boolean;
  templateId?: string | null;
  note?: string | null;
  isChargeable?: boolean;
  unitPrice?: number | null;
};

export type UpdateAdditionalPrintItemResult =
  | { ok: true; item: Awaited<ReturnType<typeof prisma.additionalPrintItem.findUniqueOrThrow>>; alreadyPrintedWarning: boolean }
  | { ok: false; status: number; error: string };

/**
 * 修改一筆附加列印項目（需求「四、編輯」）。如果這筆項目已經列印過
 * （isPrinted=true），修改仍然會成功，但會回傳 alreadyPrintedWarning=true，
 * 前端要顯示警告（需求「十四」：已列印後若要修改名稱或數量，需顯示警告並
 * 留下版本紀錄）——版本紀錄一律會寫，不管有沒有列印過。
 */
export async function updateAdditionalPrintItem(
  householdId: string,
  year: number,
  entryId: string,
  itemId: string,
  input: UpdateAdditionalPrintItemInput,
  operatorName?: string | null
): Promise<UpdateAdditionalPrintItemResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }

  const existing = await prisma.additionalPrintItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.deletedAt || existing.sourceEntryId !== entryId) {
    return { ok: false, status: 404, error: "找不到這筆附加列印項目" };
  }
  if (existing.status === "CANCELLED") {
    return { ok: false, status: 400, error: "已取消的項目請先恢復，才能修改" };
  }

  const usesSourceName = input.usesSourceName ?? existing.usesSourceName;
  const quantity = input.quantity ?? existing.quantity;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, status: 400, error: "數量必須是至少 1 的整數" };
  }

  const printName =
    input.usesSourceName !== undefined || input.customPrintName !== undefined
      ? resolvePrintName(usesSourceName, context.entry.displayName, input.customPrintName ?? existing.printName)
      : existing.printName;

  const isChargeable = input.isChargeable ?? existing.isChargeable;
  const unitPrice =
    input.unitPrice !== undefined ? input.unitPrice : existing.unitPrice ? existing.unitPrice.toNumber() : null;
  const fee = computeAdditionalPrintItemFee(isChargeable, unitPrice, quantity);

  // 修正：AdditionalPrintItem.templateId 是 @relation(fields: [templateId], ...)
  // 的純量外鍵欄位，Prisma 產生的「Checked」版 AdditionalPrintItemUpdateInput
  // 只允許用巢狀的 template: { connect/disconnect } 寫法操作這個關聯，不接受
  // 直接指派 templateId 這個純量欄位，導致 Render Build 出現 TypeScript 錯誤
  // （"Property 'templateId' does not exist on type 'AdditionalPrintItemUpdateInput'"）。
  // 這裡改用「Unchecked」版型別——Prisma Client 執行期本來就同時支援兩種寫法，
  // 只是型別宣告要對應到允許直接寫純量外鍵的版本，不影響任何執行邏輯或資料庫寫入結果。
  const data: Prisma.AdditionalPrintItemUncheckedUpdateInput = {
    usesSourceName,
    quantity,
    printName,
    isChargeable,
    unitPrice,
    subtotal: fee.subtotal,
  };
  if (input.itemType !== undefined) data.itemType = input.itemType;
  if (input.isExtra !== undefined) data.isExtra = input.isExtra;
  if (input.templateId !== undefined) data.templateId = input.templateId;
  if (input.note !== undefined) data.note = input.note;

  const wasAlreadyPrinted = existing.isPrinted;

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({ where: { id: itemId }, data });
    await recordVersion(
      {
        entityType: "AdditionalPrintItem",
        entityId: itemId,
        action: "UPDATE",
        beforeData: existing,
        afterData: after,
        operatorName,
        changeNote: wasAlreadyPrinted ? "此項目已列印後又被修改" : null,
      },
      tx
    );
    return after;
  });

  return { ok: true, item: updated, alreadyPrintedWarning: wasAlreadyPrinted };
}

/** 取消一筆附加列印項目（需求「十三」：狀態改為取消，保留歷史，不再出現在待列印清單）。 */
export async function cancelAdditionalPrintItem(
  householdId: string,
  year: number,
  entryId: string,
  itemId: string,
  operatorName?: string | null
): Promise<AdditionalPrintItemMutationResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }
  const existing = await prisma.additionalPrintItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.deletedAt || existing.sourceEntryId !== entryId) {
    return { ok: false, status: 404, error: "找不到這筆附加列印項目" };
  }
  if (existing.status === "CANCELLED") {
    return { ok: false, status: 400, error: "這筆項目已經是取消狀態" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
    await recordVersion(
      { entityType: "AdditionalPrintItem", entityId: itemId, action: "UPDATE", beforeData: existing, afterData: after, operatorName, changeNote: "取消" },
      tx
    );
    return after;
  });

  return { ok: true, item: updated };
}

/**
 * 將一筆已取消的附加列印項目移入回收區（需求「十三」：永久刪除的第一步，
 * 只有 SUPER_ADMIN 能操作，呼叫端須先用
 * src/lib/permissions.ts 的 assertAdditionalPrintItemPermission(role,
 * "permanentlyDelete") 檢查權限，並在前端要求雙重確認）。
 *
 * 設計上要求先「取消」才能移入回收區——附加列印項目不會在還是「待列印／
 * 已列印」的有效狀態下被直接刪除，一定要先經過「取消」這一步，確保任何
 * 移除動作都有清楚的狀態轉換與版本紀錄可查。真正的永久刪除（硬刪除）沿用
 * src/lib/recycleBin.ts 既有的 30 天保留期限機制（purgeRecycleBinItem），
 * 不在這裡直接執行 SQL DELETE。
 */
export async function moveAdditionalPrintItemToRecycleBin(
  itemId: string,
  operatorName?: string | null
): Promise<AdditionalPrintItemMutationResult> {
  const existing = await prisma.additionalPrintItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆附加列印項目" };
  }
  if (existing.status !== "CANCELLED") {
    return { ok: false, status: 400, error: "只有已取消的項目可以移入回收區，請先執行取消" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });
    await recordVersion(
      {
        entityType: "AdditionalPrintItem",
        entityId: itemId,
        action: "DELETE",
        beforeData: existing,
        afterData: after,
        operatorName,
        changeNote: "移入回收區（待永久刪除）",
      },
      tx
    );
    return after;
  });

  return { ok: true, item: updated };
}

/** 恢復一筆已取消的附加列印項目：依照是否已列印過，回到「待列印」或「已列印」狀態。 */
export async function restoreCancelledAdditionalPrintItem(
  householdId: string,
  year: number,
  entryId: string,
  itemId: string,
  operatorName?: string | null
): Promise<AdditionalPrintItemMutationResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }
  const existing = await prisma.additionalPrintItem.findUnique({ where: { id: itemId } });
  if (!existing || existing.deletedAt || existing.sourceEntryId !== entryId) {
    return { ok: false, status: 404, error: "找不到這筆附加列印項目" };
  }
  if (existing.status !== "CANCELLED") {
    return { ok: false, status: 400, error: "這筆項目目前不是取消狀態" };
  }

  const nextStatus: AdditionalPrintItemStatusValue = existing.isPrinted ? "PRINTED" : "PENDING_PRINT";

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({ where: { id: itemId }, data: { status: nextStatus } });
    await recordVersion(
      { entityType: "AdditionalPrintItem", entityId: itemId, action: "RESTORE", beforeData: existing, afterData: after, operatorName, changeNote: "取消後恢復" },
      tx
    );
    return after;
  });

  return { ok: true, item: updated };
}

// ============================================================
// 列印批次（需求「九、十」）
// ============================================================

export type GenerateBatchResult =
  | { ok: true; batchId: string; printedCount: number; reprintedCount: number }
  | { ok: false; status: number; error: string };

/**
 * 產生一個列印批次：把選定的附加列印項目標記為已列印（第一次列印）或補印
 * （已經列印過），quantity（原始數量）不會被修改（需求「十」）。批次會建立
 * 一筆 TempleEventPrintBatch；如果選取的項目全部屬於同一個活動
 * （activityId 相同），批次會掛在那個活動底下，否則 templeEventId 留空
 * （見 schema.prisma 對 TempleEventPrintBatch.templeEventId 允許為空的
 * 說明）。
 */
export async function generateAdditionalPrintItemBatch(
  itemIds: string[],
  options: { printedByName?: string | null; templateVersionId?: string | null },
  operatorName?: string | null
): Promise<GenerateBatchResult> {
  if (itemIds.length === 0) {
    return { ok: false, status: 400, error: "請至少選擇一筆要列印的項目" };
  }

  const items = await prisma.additionalPrintItem.findMany({
    where: { id: { in: itemIds }, deletedAt: null },
  });
  if (items.length !== itemIds.length) {
    return { ok: false, status: 404, error: "有選取的項目找不到，請重新整理後再試一次" };
  }
  const cancelledOnes = items.filter((i) => i.status === "CANCELLED");
  if (cancelledOnes.length > 0) {
    return { ok: false, status: 400, error: "選取的項目裡有已取消的項目，請先取消勾選再列印" };
  }

  const distinctActivityIds = new Set(items.map((i) => i.activityId ?? null));
  const commonTempleEventId = distinctActivityIds.size === 1 ? [...distinctActivityIds][0] : null;

  let printedCount = 0;
  let reprintedCount = 0;

  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.templeEventPrintBatch.create({
      data: {
        templeEventId: commonTempleEventId,
        registrationCount: items.length,
        printedByName: options.printedByName ?? null,
      },
    });

    for (const item of items) {
      const wasPrinted = item.isPrinted;
      const next = applyPrintAction(
        { quantity: item.quantity, printedQuantity: item.printedQuantity, reprintCount: item.reprintCount, isPrinted: item.isPrinted },
        item.quantity
      );
      if (wasPrinted) reprintedCount++;
      else printedCount++;

      const after = await tx.additionalPrintItem.update({
        where: { id: item.id },
        data: {
          isPrinted: true,
          printedQuantity: next.printedQuantity,
          reprintCount: next.reprintCount,
          printedAt: new Date(),
          printedByName: options.printedByName ?? null,
          printBatchId: batch.id,
          templateVersionId: options.templateVersionId ?? item.templateVersionId,
          status: "PRINTED",
        },
      });

      await recordVersion(
        {
          entityType: "AdditionalPrintItem",
          entityId: item.id,
          action: "UPDATE",
          beforeData: item,
          afterData: after,
          operatorName,
          changeNote: wasPrinted ? "補印" : "列印",
        },
        tx
      );
    }

    return batch.id;
  });

  return { ok: true, batchId, printedCount, reprintedCount };
}

// ============================================================
// 活動摘要（需求「十五」）
// ============================================================

export type AdditionalPrintItemActivitySummary = ReturnType<typeof summarizePrintItems>;

/**
 * 某個活動（TempleEvent）底下的附加列印項目摘要（需求「十五」：活動摘要
 * 需顯示預設寶袋數量／額外寶袋數量／寶袋總數／待列印數量／已列印數量）。
 * 只統計 activityId 等於這個活動 id 的項目——見 schema.prisma 對
 * activityId 可為空的說明，只有透過活動精靈建立/沿用去年的普渡活動才會
 * 有完整的摘要數字；V10.0 之前就存在、沒有 activityId 的既有普渡登記，
 * 這裡不會被計入任何一個活動的摘要（因為它們本來就不屬於任何一個活動
 * 精靈建立的活動）。
 */
export async function getAdditionalPrintItemActivitySummary(
  templeEventId: string
): Promise<AdditionalPrintItemActivitySummary> {
  const items = await prisma.additionalPrintItem.findMany({
    where: { activityId: templeEventId, deletedAt: null },
    select: { isExtra: true, status: true },
  });
  return summarizePrintItems(items as { isExtra: boolean; status: AdditionalPrintItemStatusValue }[]);
}

// ============================================================
// 列印中心（需求「九」）：跨家戶依年度查詢/篩選
// ============================================================

export type PrintCenterFilters = {
  activityId?: string; // 活動（TempleEvent）
  householdId?: string;
  registrantName?: string; // 報名人（比對來源登記項目的 displayName / 陽上姓名）
  sourceCategory?: string; // 原祭祀類型
  sourceName?: string; // 原祭祀名稱（模糊搜尋，比對來源登記項目的 displayName）
  printName?: string; // 寶袋列印名稱（模糊搜尋）
  isExtra?: boolean;
  status?: AdditionalPrintItemStatusValue;
};

export type PrintCenterItemView = {
  id: string;
  household: { id: string; name: string };
  sourceCategory: string;
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  itemType: string;
  printName: string;
  quantity: number;
  isExtra: boolean;
  status: AdditionalPrintItemStatusValue;
  isPrinted: boolean;
  printedQuantity: number;
  note: string | null;
};

/**
 * 普渡列印中心（需求「九」）：跨家戶依年度查詢，可依活動/家戶/報名人/原
 * 祭祀類型/原祭祀名稱/寶袋列印名稱/預設額外/待列印已列印篩選。
 *
 * sourceEntryId 不是強制 FK（見 schema.prisma 說明），這裡分兩步查詢：
 * 先查符合條件的 AdditionalPrintItem，再一次把對應的 UniversalSalvationEntry
 * 撈出來合併，避免對每一筆都各自查一次資料庫。
 */
export async function listPrintItemsForPrintCenter(
  year: number,
  filters: PrintCenterFilters
): Promise<PrintCenterItemView[]> {
  const where: Prisma.AdditionalPrintItemWhereInput = {
    deletedAt: null,
    ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
  };
  if (filters.activityId) where.activityId = filters.activityId;
  if (filters.householdId) where.householdId = filters.householdId;
  if (filters.isExtra !== undefined) where.isExtra = filters.isExtra;
  if (filters.status) where.status = filters.status;
  if (filters.printName) where.printName = { contains: filters.printName };

  const items = await prisma.additionalPrintItem.findMany({
    where,
    include: { household: true },
    orderBy: [{ createdAt: "desc" }],
  });

  const sourceEntryIds = [...new Set(items.map((i) => i.sourceEntryId))];
  const sourceEntries = sourceEntryIds.length
    ? await prisma.universalSalvationEntry.findMany({ where: { id: { in: sourceEntryIds } } })
    : [];
  const sourceEntryById = new Map(sourceEntries.map((e) => [e.id, e]));

  const views: PrintCenterItemView[] = [];
  for (const item of items) {
    const source = sourceEntryById.get(item.sourceEntryId);
    if (!source) continue; // 來源資料已經不存在（理論上不應該發生，safety net）

    if (filters.sourceCategory && source.category !== filters.sourceCategory) continue;
    if (filters.sourceName && !source.displayName.includes(filters.sourceName)) continue;
    if (
      filters.registrantName &&
      !source.displayName.includes(filters.registrantName) &&
      !(source.yangshangName ?? "").includes(filters.registrantName)
    ) {
      continue;
    }

    views.push({
      id: item.id,
      household: { id: item.household.id, name: item.household.name },
      sourceCategory: source.category,
      sourceCategoryLabel: universalSalvationEntryCategoryLabel[source.category] ?? source.category,
      sourceDisplayName: source.displayName,
      itemType: item.itemType,
      printName: item.printName,
      quantity: item.quantity,
      isExtra: item.isExtra,
      status: item.status as AdditionalPrintItemStatusValue,
      isPrinted: item.isPrinted,
      printedQuantity: item.printedQuantity,
      note: item.note,
    });
  }

  return views;
}

// ============================================================
// Excel/CSV 智慧匯入（需求「八」方式二：明細工作表）
// ============================================================

export type AdditionalPrintItemImportRowStatus =
  | "NEW"
  | "DUPLICATE"
  | "MISSING_DATA"
  | "NEEDS_CONFIRMATION";

export type AnalyzedAdditionalPrintItemRow = {
  rowNumber: number;
  mapped: Record<string, unknown>;
  status: AdditionalPrintItemImportRowStatus;
  issues: string[];
  resolved?: { entryId: string; ritualRecordId: string; householdId: string };
};

export type AdditionalPrintItemImportAnalysis = {
  rows: AnalyzedAdditionalPrintItemRow[];
  summary: { total: number; new: number; duplicate: number; missingData: number; needsConfirmation: number };
};

const SOURCE_CATEGORY_LABEL_TO_CODE: Record<string, string> = {
  歷代祖先: "ANCESTOR_LINE",
  個人乙位正魂: "INDIVIDUAL_SOUL",
  冤親債主: "DEBT_CREDITOR",
  無緣子女: "UNBORN_CHILD",
};

const ITEM_TYPE_LABEL_TO_CODE: Record<string, string> = {
  寶袋: "POCKET",
  牌位: "TABLET",
  疏文: "PETITION",
  燈牌: "LANTERN_TABLET",
  其他列印項目: "OTHER",
  其他: "OTHER",
};

const VALID_CATEGORY_CODES = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);
const VALID_ITEM_TYPE_CODES = new Set(["POCKET", "TABLET", "PETITION", "LANTERN_TABLET", "OTHER"]);

/** Excel 儲存格裡可能是中文標籤（歷代祖先）也可能是英文代碼（ANCESTOR_LINE），兩者都接受。 */
function resolveSourceCategoryInput(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (VALID_CATEGORY_CODES.has(value.toUpperCase())) return value.toUpperCase();
  return SOURCE_CATEGORY_LABEL_TO_CODE[value] ?? null;
}

function resolveItemTypeInput(raw: unknown): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (VALID_ITEM_TYPE_CODES.has(value.toUpperCase())) return value.toUpperCase();
  return ITEM_TYPE_LABEL_TO_CODE[value] ?? null;
}

function resolveIsExtraInput(raw: unknown): boolean {
  const value = String(raw ?? "").trim();
  if (!value) return true; // 明細工作表沒有預設/額外欄位時，一律視為額外新增
  return value === "額外" || value === "是" || value.toUpperCase() === "TRUE";
}

/**
 * 分析明細工作表匯入資料（需求「八」方式二）：找不到對應的來源祭祀資料
 * （家戶＋這一年普渡登記＋分類＋名稱都要完全比對得上）時，不得直接匯入，
 * 一律列入待確認清單。純查詢，不寫入任何正式資料。
 */
export async function analyzeAdditionalPrintItemImport(
  year: number,
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>
): Promise<AdditionalPrintItemImportAnalysis> {
  function applyMapping(row: Record<string, unknown>): Record<string, unknown> {
    const mapped: Record<string, unknown> = {};
    for (const [col, value] of Object.entries(row)) {
      const target = mapping[col];
      if (target) mapped[target] = value;
    }
    return mapped;
  }

  const analyzed: AnalyzedAdditionalPrintItemRow[] = [];
  let newCount = 0;
  let duplicateCount = 0;
  let missingCount = 0;
  let needsConfirmCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2;
    const mapped = applyMapping(rows[i]);
    const issues: string[] = [];

    const householdId = String(mapped.householdId ?? "").trim();
    const sourceCategory = resolveSourceCategoryInput(mapped.sourceCategory);
    const sourceName = String(mapped.sourceName ?? "").trim();
    const itemType = resolveItemTypeInput(mapped.itemType);
    const printName = String(mapped.printName ?? "").trim();

    if (!householdId) issues.push("缺少家戶編號");
    if (!sourceCategory) issues.push("原祭祀類型缺少或無法辨識（需為歷代祖先/個人乙位正魂/冤親債主/無緣子女）");
    if (!sourceName) issues.push("缺少原祭祀名稱");
    if (!itemType) issues.push("附加項目類型缺少或無法辨識（需為寶袋/牌位/疏文/燈牌/其他列印項目）");
    if (!printName) issues.push("缺少列印名稱");

    if (issues.length > 0) {
      missingCount++;
      analyzed.push({ rowNumber, mapped, status: "MISSING_DATA", issues });
      continue;
    }

    const household = await prisma.household.findFirst({ where: { id: householdId, deletedAt: null } });
    if (!household) {
      needsConfirmCount++;
      analyzed.push({ rowNumber, mapped, status: "NEEDS_CONFIRMATION", issues: [`找不到家戶編號「${householdId}」`] });
      continue;
    }

    const ritualRecord = await prisma.ritualRecord.findUnique({
      where: { householdId_year_activityType: { householdId, year, activityType: "UNIVERSAL_SALVATION" } },
      include: { universalSalvation: { include: { entries: { where: { deletedAt: null } } } } },
    });
    if (!ritualRecord || ritualRecord.deletedAt || !ritualRecord.universalSalvation) {
      needsConfirmCount++;
      analyzed.push({ rowNumber, mapped, status: "NEEDS_CONFIRMATION", issues: [`這一戶 ${year} 年沒有普渡登記資料`] });
      continue;
    }

    const sourceEntry = ritualRecord.universalSalvation.entries.find((e) =>
      matchesSourceEntry(e, { sourceCategory: sourceCategory!, sourceName })
    );
    if (!sourceEntry) {
      needsConfirmCount++;
      analyzed.push({
        rowNumber,
        mapped,
        status: "NEEDS_CONFIRMATION",
        issues: [`找不到來源祭祀資料「${sourceName}」，請確認原祭祀類型/名稱是否正確`],
      });
      continue;
    }

    const quantity = resolveDetailSheetQuantity(mapped.quantity);
    const isExtra = resolveIsExtraInput(mapped.isExtra);

    const duplicate = await prisma.additionalPrintItem.findFirst({
      where: { sourceEntryId: sourceEntry.id, printName, quantity, isExtra, deletedAt: null, status: { not: "CANCELLED" } },
    });

    if (duplicate) {
      duplicateCount++;
      analyzed.push({
        rowNumber,
        mapped,
        status: "DUPLICATE",
        issues: ["這個名稱/數量的附加列印項目已經存在"],
        resolved: { entryId: sourceEntry.id, ritualRecordId: ritualRecord.id, householdId },
      });
      continue;
    }

    newCount++;
    analyzed.push({
      rowNumber,
      mapped,
      status: "NEW",
      issues: [],
      resolved: { entryId: sourceEntry.id, ritualRecordId: ritualRecord.id, householdId },
    });
  }

  return {
    rows: analyzed,
    summary: {
      total: rows.length,
      new: newCount,
      duplicate: duplicateCount,
      missingData: missingCount,
      needsConfirmation: needsConfirmCount,
    },
  };
}

export type CommitAdditionalPrintItemImportResult = {
  importedCount: number;
  skippedCount: number;
  errors: { rowNumber: number; error: string }[];
};

/**
 * 確認匯入（需求「八」）：預設 NEW 會匯入，DUPLICATE／MISSING_DATA／
 * NEEDS_CONFIRMATION 一律略過，除非呼叫端在 decisions 明確覆蓋成
 * "IMPORT"（例如使用者看過待確認清單、確認要匯入）。
 */
export async function commitAdditionalPrintItemImport(
  year: number,
  rows: AnalyzedAdditionalPrintItemRow[],
  decisions: Record<number, "IMPORT" | "SKIP">,
  operatorName?: string | null
): Promise<CommitAdditionalPrintItemImportResult> {
  let importedCount = 0;
  let skippedCount = 0;
  const errors: { rowNumber: number; error: string }[] = [];

  for (const row of rows) {
    const decision = decisions[row.rowNumber] ?? (row.status === "NEW" ? "IMPORT" : "SKIP");
    if (decision === "SKIP" || !row.resolved) {
      skippedCount++;
      continue;
    }

    const quantity = resolveDetailSheetQuantity(row.mapped.quantity);
    const isExtra = resolveIsExtraInput(row.mapped.isExtra);
    const itemType = resolveItemTypeInput(row.mapped.itemType);
    const printName = String(row.mapped.printName ?? "").trim();

    if (!itemType || !printName) {
      errors.push({ rowNumber: row.rowNumber, error: "資料不完整，無法匯入" });
      continue;
    }

    const result = await createAdditionalPrintItem(
      row.resolved.householdId,
      year,
      row.resolved.entryId,
      {
        itemType: itemType as AdditionalPrintItemType, // 已經過 resolveItemTypeInput 對照合法值驗證
        usesSourceName: false,
        customPrintName: printName,
        quantity,
        isExtra,
        note: String(row.mapped.notes ?? "") || null,
        status: "PENDING_PRINT",
      },
      operatorName
    );

    if (!result.ok) {
      errors.push({ rowNumber: row.rowNumber, error: result.error });
      continue;
    }
    importedCount++;
  }

  return { importedCount, skippedCount, errors };
}
