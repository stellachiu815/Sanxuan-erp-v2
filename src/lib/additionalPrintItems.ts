import { AdditionalPrintItemType, AdditionalPrintItemStatus, Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  resolvePocketUnitPrice,
  computePocketSubtotal,
  assertSubtotalNotBelowPaid,
  assertNoPaymentBeforeRemoval,
  resolvePocketPaymentState,
} from "@/lib/pocketPricing";
import {
  getAdditionalPrintItemPaidAmount,
  getAdditionalPrintItemPaidAmounts,
} from "@/lib/receivableAdapters";
import { universalSalvationEntryCategoryLabel } from "@/lib/labels";
import {
  resolvePrintName,
  computeAdditionalPrintItemFee,
  applyPrintAction,
  applyPrintToObject,
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
async function resolveEntryContext(entryId: string, db?: DbClient): Promise<EntryContext | null> {
  const entry = await (db ?? prisma).universalSalvationEntry.findUnique({
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

/**
 * V13.3B：附加列印項目 ＋ 即時計算的付款狀態。
 *
 * amountPaid／amountUnpaid／paymentStatus 都是**即時由 PaymentAllocation
 * − PaymentAdjustment 算出來的**，不是資料庫欄位。
 * isPaid 也覆寫成計算結果，避免畫面讀到過時的快照。
 */
export type AdditionalPrintItemWithPayment =
  Awaited<ReturnType<typeof prisma.additionalPrintItem.findMany>>[number] & {
    amountPaid: number;
    amountUnpaid: number;
    paymentStatus: "FREE" | "UNPAID" | "PARTIAL" | "PAID";
  };

export type AdditionalPrintItemListResult =
  | {
      ok: true;
      items: AdditionalPrintItemWithPayment[];
      /** 這個年度活動的寶袋預設單價（已 fallback，供「新增」時帶入） */
      activityPocketUnitPrice: number;
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

  /**
   * V13.3B：補上 UI 需要的付款狀態欄位。
   *
   * ⚠️ 避免 N+1：用**一次批次查詢**取得所有項目的已收金額
   * （內部只發 3 個 query，與筆數無關），不在迴圈裡逐筆查資料庫。
   *
   * ⚠️ amountPaid 來自 PaymentAllocation − PaymentAdjustment，
   * **不信任舊的 paymentId 欄位**（它是單一欄位，無法表達多次付款）。
   */
  const paidMap = await getAdditionalPrintItemPaidAmounts(items.map((i) => i.id));

  // 年度預設單價：供畫面顯示「新增時會帶入多少」
  const activity = context.templeEventId
    ? await prisma.templeEvent.findUnique({
        where: { id: context.templeEventId },
        select: { pocketUnitPrice: true },
      })
    : null;
  const activityPocketUnitPrice = resolvePocketUnitPrice(
    activity?.pocketUnitPrice ? Number(activity.pocketUnitPrice) : null
  );

  const withPayment: AdditionalPrintItemWithPayment[] = items.map((item) => {
    const subtotal = Number(item.subtotal ?? 0);
    const amountPaid = paidMap.get(item.id) ?? 0;
    const state = resolvePocketPaymentState(subtotal, amountPaid);
    return {
      ...item,
      amountPaid,
      amountUnpaid: state.amountUnpaid,
      /** 依實際分配金額判斷，不採用資料庫的 isPaid 快照 */
      isPaid: state.isPaid,
      paymentStatus: state.status,
    };
  });

  return { ok: true, items: withPayment, activityPocketUnitPrice };
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
  operatorName?: string | null,
  db?: DbClient
): Promise<AdditionalPrintItemMutationResult> {
  const client = db ?? prisma;
  const context = await resolveEntryContext(entryId, db);
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

  /**
   * V13.3B 計價（三層來源，見 src/lib/pocketPricing.ts）：
   *   1. 前端明確指定的 unitPrice
   *   2. 該年度活動的 TempleEvent.pocketUnitPrice
   *   3. 系統預設 300
   *
   * ⚠️ subtotal **一律由伺服器重算**，前端送來的 subtotal 完全不採用
   *    （指令第四階段之 4）。
   */
  const isChargeable = input.isChargeable ?? true; // 寶袋正常新增預設收費
  let unitPrice = input.unitPrice ?? null;
  if (isChargeable && (unitPrice === null || unitPrice === undefined)) {
    const activity = context.templeEventId
      ? await client.templeEvent.findUnique({
          where: { id: context.templeEventId },
          select: { pocketUnitPrice: true },
        })
      : null;
    unitPrice = resolvePocketUnitPrice(
      activity?.pocketUnitPrice ? Number(activity.pocketUnitPrice) : null
    );
  }

  const feeResult = computePocketSubtotal({ isChargeable, unitPrice, quantity: input.quantity });
  if (!feeResult.ok) {
    return { ok: false, status: 400, error: feeResult.error };
  }
  const fee = { subtotal: feeResult.subtotal };

  const runCreate = async (tx: DbClient) => {
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
        isChargeable,
        unitPrice,
        subtotal: fee.subtotal,
        // isPaid 一律由實際收款分配決定，建立時必為 false（指令第四階段之 8、9）
        isPaid: false,
        createdBy: operatorName?.trim() || null,
      },
    });

    await recordVersion(
      { entityType: "AdditionalPrintItem", entityId: item.id, action: "CREATE", afterData: item, operatorName },
      tx
    );

    return item;
  };
  const created = db ? await runCreate(db) : await prisma.$transaction(runCreate);

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
  /**
   * V13.3B：改為由 pocketPricing 單一真實來源重算，並加上財務防呆。
   * 前端送來的 subtotal 一律不採用。
   */
  const feeResult = computePocketSubtotal({ isChargeable, unitPrice, quantity });
  if (!feeResult.ok) {
    return { ok: false, status: 400, error: feeResult.error };
  }
  const fee = { subtotal: feeResult.subtotal };

  /**
   * 指令第五階段之二：新的應收金額**不得低於已收金額**。
   * 否則會出現「已收 600、應收被改成 300」這種無法對帳的狀態。
   * 必須先退款／沖銷差額，才能往下調。
   */
  const paidBefore = await getAdditionalPrintItemPaidAmount(itemId);
  const guard = assertSubtotalNotBelowPaid(fee.subtotal ?? 0, paidBefore);
  if (guard.ok === false) {
    return { ok: false, status: 409, error: guard.error };
  }

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

  /**
   * V13.3B 指令第五階段之三：已有付款分配的寶袋**不得直接取消**。
   * 必須先於收款中心辦理退款／沖銷，否則會留下「已收款但項目已取消」
   * 的孤兒帳務。
   */
  const paidForCancel = await getAdditionalPrintItemPaidAmount(itemId);
  const cancelGuard = assertNoPaymentBeforeRemoval(paidForCancel, "取消");
  if (cancelGuard.ok === false) {
    return { ok: false, status: 409, error: cancelGuard.error };
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

  /**
   * V13.3B 指令第五階段之四：有任何付款分配的項目**禁止直接刪除**。
   *
   * ⚠️ 理論上走到這裡的項目一定已經是 CANCELLED，而 cancel 那一步已經
   * 擋過一次；這裡是第二道防線——避免日後有人新增別的路徑直接把狀態
   * 改成 CANCELLED 再刪除，繞過財務檢查。
   *
   * 絕不允許用刪除 PaymentAllocation／Receipt 來掩蓋歷史紀錄。
   */
  const paidForDelete = await getAdditionalPrintItemPaidAmount(itemId);
  const deleteGuard = assertNoPaymentBeforeRemoval(paidForDelete, "刪除");
  if (deleteGuard.ok === false) {
    return { ok: false, status: 409, error: deleteGuard.error };
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

/**
 * 恢復一筆已取消的附加列印項目：依照是否已列印過，回到「待列印」或
 * 「已列印」狀態。
 *
 * V13.3B 指令第五階段之五：恢復時**重新依 quantity／unitPrice／
 * isChargeable 重算 subtotal**，讓它再次出現在待收款清單。
 *
 * ⚠️ 不會自動恢復成「已付款」：isPaid 由實際的 PaymentAllocation 決定。
 * 若這筆的歷史付款已被正式退款（PaymentAdjustment），重算後已收金額
 * 就是 0，會正確回到「未收」狀態，不會憑空變回已付款。
 */
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
    /**
     * V13.3B：恢復時重新計算 subtotal（依目前的 quantity／unitPrice／
     * isChargeable），讓這筆重新以正確金額回到待收款清單。
     *
     * isPaid 一併依實際 PaymentAllocation 重算——若歷史付款已被退款，
     * 這裡會正確回到 false，不會憑空恢復成已付款。
     */
    const recomputed = computePocketSubtotal({
      isChargeable: existing.isChargeable,
      unitPrice: existing.unitPrice ? existing.unitPrice.toNumber() : null,
      quantity: existing.quantity,
    });
    const restoredPaid = await getAdditionalPrintItemPaidAmount(itemId);
    const restoredSubtotal = recomputed.ok ? recomputed.subtotal : Number(existing.subtotal ?? 0);
    const restoredState = resolvePocketPaymentState(restoredSubtotal, restoredPaid);

    const after = await tx.additionalPrintItem.update({
      where: { id: itemId },
      data: {
        status: nextStatus,
        subtotal: restoredSubtotal,
        isPaid: restoredState.isPaid,
      },
    });
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
// V14.4「牌位建立時自動建立列印物件」（指令 Part 2）
// ============================================================

export type EnsureTabletPrintObjectsInput = {
  ritualRecordId: string;
  householdId: string;
  sourceEntryId: string;
  printName: string;
  memberId?: string | null;
  activityId?: string | null;
};

/**
 * 確保一筆有效牌位（UniversalSalvationEntry）有其預設列印物件：TABLET × 1、
 * 預設 POCKET × 1。兩者共用同一 sourceEntryId（姓名/陽上人/地址只存 entry 一份，
 * 這裡不複製內容，只各自保存列印狀態與版型類型 itemType）。
 *
 * 冪等（指令 Part 2.4）：同一 sourceEntryId＋itemType 的「預設物件（isExtra=false、
 * 未刪除）」已存在就不重複建立——重送/連點不會產生兩個 TABLET 或兩個預設 POCKET。
 * DB 另有 partial unique index（見 migration）作為硬防重；這裡先查存在再建立，
 * 兩層一致。可傳入既有 transaction client（tx）以與牌位建立同一交易。
 *
 * 預設 POCKET 不收費（isChargeable=false）——額外寶袋才可能產生應收（Part 2.5）。
 */
export async function ensureTabletPrintObjects(
  input: EnsureTabletPrintObjectsInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ createdTablet: boolean; createdPocket: boolean }> {
  const existing = await client.additionalPrintItem.findMany({
    where: {
      sourceEntryId: input.sourceEntryId,
      sourceEntryType: "UNIVERSAL_SALVATION_ENTRY",
      isExtra: false,
      deletedAt: null,
      itemType: { in: [AdditionalPrintItemType.TABLET, AdditionalPrintItemType.POCKET] },
    },
    select: { itemType: true },
  });
  const hasTablet = existing.some((e) => e.itemType === AdditionalPrintItemType.TABLET);
  const hasPocket = existing.some((e) => e.itemType === AdditionalPrintItemType.POCKET);

  const base = {
    ritualRecordId: input.ritualRecordId,
    householdId: input.householdId,
    sourceEntryId: input.sourceEntryId,
    sourceEntryType: "UNIVERSAL_SALVATION_ENTRY",
    memberId: input.memberId ?? null,
    activityId: input.activityId ?? null,
    printName: input.printName,
    usesSourceName: true,
    quantity: 1,
    isExtra: false,
    isChargeable: false, // 預設 TABLET／POCKET 不收費（額外寶袋才收費）
    status: AdditionalPrintItemStatus.PENDING_PRINT,
    printCount: 0,
  };

  let createdTablet = false;
  let createdPocket = false;
  if (!hasTablet) {
    await client.additionalPrintItem.create({ data: { ...base, itemType: AdditionalPrintItemType.TABLET } });
    createdTablet = true;
  }
  if (!hasPocket) {
    await client.additionalPrintItem.create({ data: { ...base, itemType: AdditionalPrintItemType.POCKET } });
    createdPocket = true;
  }
  return { createdTablet, createdPocket };
}

// ============================================================
// V14.4「確認完成列印」：列印物件層的首印／補印確認（指令一）
// ============================================================

export type ConfirmPrintResult =
  | { ok: true; batchId: string; printedCount: number; reprintedCount: number; deduplicated: boolean }
  | { ok: false; status: number; error: string };

/**
 * 確認完成列印（單筆或批次）。**只在使用者按下「確認完成列印」時呼叫**，
 * 不因開啟預覽而累加（指令一）。
 *
 * - 使用 AdditionalPrintItem 作為每個 TABLET／POCKET 列印物件；以純函式
 *   applyPrintToObject 計算首印／補印後的 printCount 與時間戳。
 * - 首印設一次 firstPrintedAt；補印保留 firstPrintedAt、更新 lastPrintedAt／
 *   lastPrintedByUserId（session 使用者），並同步既有相容欄位（isPrinted／
 *   printedAt／reprintCount／status），不動任何報名/應收/收款（補印不新增應收）。
 * - 批次一律在單一 transaction 內完成。
 * - idempotencyKey：相同 key 重送（連點／逾時重試）因 batch 唯一鍵衝突而視為
 *   同一次，直接回報既有批次、**不重複累加**（deduplicated=true）。
 *
 * 操作人 lastPrintedByUserId 一律由呼叫端（API）從 session 帶入，這裡不接受
 * 前端傳入身分；權限（READONLY 拒絕）由 API 層 assertUniversalSalvationPermission 把關。
 */
export async function confirmPrintObjects(
  itemIds: string[],
  input: { userId: string; operatorName?: string | null; idempotencyKey: string; templateVersionId?: string | null }
): Promise<ConfirmPrintResult> {
  if (itemIds.length === 0) return { ok: false, status: 400, error: "請至少選擇一筆要列印的項目" };
  if (!input.idempotencyKey || !input.idempotencyKey.trim()) {
    return { ok: false, status: 400, error: "缺少列印確認識別碼（idempotencyKey）" };
  }
  if (!input.userId) return { ok: false, status: 401, error: "尚未登入" };

  // 冪等：同一個 key 已經確認過 → 直接回既有批次，不重複累加。
  const existingBatch = await prisma.templeEventPrintBatch.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existingBatch) {
    return { ok: true, batchId: existingBatch.id, printedCount: 0, reprintedCount: 0, deduplicated: true };
  }

  const items = await prisma.additionalPrintItem.findMany({
    where: { id: { in: itemIds }, deletedAt: null },
  });
  if (items.length !== itemIds.length) {
    return { ok: false, status: 404, error: "有選取的項目找不到，請重新整理後再試一次" };
  }
  if (items.some((i) => i.status === "CANCELLED")) {
    return { ok: false, status: 400, error: "選取的項目裡有已取消的項目，請先取消勾選再列印" };
  }

  const distinctActivityIds = new Set(items.map((i) => i.activityId ?? null));
  const commonTempleEventId = distinctActivityIds.size === 1 ? [...distinctActivityIds][0] : null;

  let printedCount = 0;
  let reprintedCount = 0;

  try {
    const batchId = await prisma.$transaction(async (tx) => {
      const batch = await tx.templeEventPrintBatch.create({
        data: {
          templeEventId: commonTempleEventId,
          registrationCount: items.length,
          printedByName: input.operatorName ?? null,
          idempotencyKey: input.idempotencyKey,
        },
      });

      const now = new Date();
      for (const item of items) {
        const wasPrinted = (item.printCount ?? 0) > 0 || item.isPrinted;
        const next = applyPrintToObject(
          {
            printCount: item.printCount ?? 0,
            firstPrintedAt: item.firstPrintedAt ?? item.printedAt ?? null,
            lastPrintedAt: item.lastPrintedAt ?? item.printedAt ?? null,
            lastPrintedByUserId: item.lastPrintedByUserId ?? null,
          },
          now,
          input.userId
        );
        if (wasPrinted) reprintedCount++;
        else printedCount++;

        const after = await tx.additionalPrintItem.update({
          where: { id: item.id },
          data: {
            // 新列印物件層欄位：
            printCount: next.printCount,
            firstPrintedAt: next.firstPrintedAt,
            lastPrintedAt: next.lastPrintedAt,
            lastPrintedByUserId: next.lastPrintedByUserId,
            // 相容既有欄位（列印中心/篩選仍會讀）：
            isPrinted: true,
            printedAt: item.firstPrintedAt ?? item.printedAt ?? now, // 首印時間，不覆蓋
            printedByName: input.operatorName ?? item.printedByName ?? null,
            printedQuantity: wasPrinted ? item.printedQuantity + item.quantity : item.quantity,
            reprintCount: wasPrinted ? item.reprintCount + 1 : item.reprintCount,
            printBatchId: batch.id,
            templateVersionId: input.templateVersionId ?? item.templateVersionId,
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
            operatorName: input.operatorName,
            changeNote: wasPrinted ? "補印（確認完成列印）" : "列印（確認完成列印）",
          },
          tx
        );
      }

      return batch.id;
    });

    return { ok: true, batchId, printedCount, reprintedCount, deduplicated: false };
  } catch (e) {
    // 冪等鍵競態：兩個併發請求同 key，其中一個唯一鍵衝突 → 視為重複，不累加。
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const b = await prisma.templeEventPrintBatch.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (b) return { ok: true, batchId: b.id, printedCount: 0, reprintedCount: 0, deduplicated: true };
    }
    throw e;
  }
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
  sourceEntryId: string;
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
  // V14.4 列印物件層：
  printCount: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  lastPrintedByUserId: string | null;
  lastPrintedByName: string | null;
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

  // V14.4：解析最後列印操作人姓名（lastPrintedByUserId → User.name）。
  const lastPrintedByUserIds = [
    ...new Set(items.map((i) => i.lastPrintedByUserId).filter((x): x is string => !!x)),
  ];
  const users = lastPrintedByUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: lastPrintedByUserIds } }, select: { id: true, name: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

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
      sourceEntryId: item.sourceEntryId,
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
      // V14.4 列印物件層欄位：
      printCount: item.printCount ?? 0,
      firstPrintedAt: (item.firstPrintedAt ?? item.printedAt) ? (item.firstPrintedAt ?? item.printedAt)!.toISOString() : null,
      lastPrintedAt: (item.lastPrintedAt ?? item.printedAt) ? (item.lastPrintedAt ?? item.printedAt)!.toISOString() : null,
      lastPrintedByUserId: item.lastPrintedByUserId ?? null,
      lastPrintedByName: item.lastPrintedByUserId ? userNameById.get(item.lastPrintedByUserId) ?? null : null,
    });
  }

  return views;
}

/**
 * V14.4 Part 3：把列印中心清單「以牌位（UniversalSalvationEntry）分組」，每組回傳
 * TABLET 與預設 POCKET 兩個列印物件的狀態，供普渡列印中心 UI 顯示雙區塊。
 * 沿用同一個 listPrintItemsForPrintCenter 查詢（同一份資料、同一個 API），不另建第二套。
 */
export type PrintObjectView = {
  id: string;
  itemType: string;
  printName: string;
  status: AdditionalPrintItemStatusValue;
  printCount: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  lastPrintedByName: string | null;
};

export type GroupedTabletPrintView = {
  sourceEntryId: string;
  household: { id: string; name: string };
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  tablet: PrintObjectView | null;
  pocket: PrintObjectView | null;
  extras: PrintObjectView[];
};

export async function listUniversalSalvationPrintGroups(
  year: number,
  filters: PrintCenterFilters = {}
): Promise<GroupedTabletPrintView[]> {
  const items = await listPrintItemsForPrintCenter(year, filters);
  const groups = new Map<string, GroupedTabletPrintView>();
  for (const it of items) {
    let g = groups.get(it.sourceEntryId);
    if (!g) {
      g = {
        sourceEntryId: it.sourceEntryId,
        household: it.household,
        sourceCategoryLabel: it.sourceCategoryLabel,
        sourceDisplayName: it.sourceDisplayName,
        tablet: null,
        pocket: null,
        extras: [],
      };
      groups.set(it.sourceEntryId, g);
    }
    const obj: PrintObjectView = {
      id: it.id,
      itemType: it.itemType,
      printName: it.printName,
      status: it.status,
      printCount: it.printCount,
      firstPrintedAt: it.firstPrintedAt,
      lastPrintedAt: it.lastPrintedAt,
      lastPrintedByName: it.lastPrintedByName,
    };
    if (it.itemType === "TABLET" && !it.isExtra) g.tablet = obj;
    else if (it.itemType === "POCKET" && !it.isExtra) g.pocket = obj;
    else g.extras.push(obj);
  }
  return [...groups.values()];
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
