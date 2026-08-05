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
import { registrationOrderForPrintItem, resolvePrintItemRegistrationOrder, dedupeDefaultPrintObjects, shouldExcludeLeakedPrintSource } from "@/lib/TabletBatchService";
import { applyRegistrationOrder } from "@/lib/registrationOrder";
import { printNumberOf } from "@/lib/workOrder";
import { resolvePrintAddress, needsReprint as computeNeedsReprint, latestIso } from "@/lib/tabletPrintFields";
import { resolveRitualDisplayName } from "@/lib/ritualDisplayName";
import { resolveYangshangNames } from "@/lib/yangshang";
import { tabletMissingFieldsForCategory } from "@/lib/dataCompleteness";
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
  /**
   * V30.3b：寶袋作業號碼識別關聯。只在建立「增加寶袋」US_POCKET_EXTRA 的列印物件時傳入，
   * 值＝該 US_POCKET_EXTRA RitualRegistrationItem.id。作業號碼一律取自這一筆報名的
   * registrationOrder，**絕不**沿用 sourceEntry（依附牌位）號碼。基本寶袋不傳（維持 null）。
   * 以 raw SQL 於**同一 transaction** 寫入（Prisma client 尚未 regenerate，故不走 typed data）。
   */
  registrationItemId?: string | null;
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

  // V30.3b：若指定自身報名識別關聯，必須是**同一 RitualRecord**、未刪除、且型別為 US_POCKET_EXTRA
  // 的 RitualRegistrationItem，否則拒絕（指令：非 US_POCKET_EXTRA 不可掛號，且不得跨戶指派）。
  if (input.registrationItemId) {
    const ok = await client.$queryRaw<{ id: string }[]>`
      SELECT rri."id"
      FROM "ritual_registration_items" rri
      JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
      WHERE rri."id" = ${input.registrationItemId}
        AND rri."ritualRecordId" = ${context.ritualRecordId}
        AND rri."deletedAt" IS NULL
        AND rit."key" = 'US_POCKET_EXTRA'
      LIMIT 1
    `;
    if (ok.length === 0) {
      return { ok: false, status: 400, error: "寶袋報名識別關聯無效：必須是同一登記下的『增加寶袋』報名項目" };
    }
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

    // V30.3b：寶袋自身報名識別關聯——同一 transaction 內以 raw SQL 寫入（client 未 regenerate）。
    // 只接受「增加寶袋」US_POCKET_EXTRA 的報名項目 id；此處只負責寫入，是否合法（型別＝POCKET）
    // 由呼叫端保證，讀取端（列印中心）另有 US_POCKET_EXTRA 型別守門，非該型別一律不顯示號碼。
    if (input.registrationItemId) {
      await tx.$executeRaw`
        UPDATE "additional_print_items"
        SET "registrationItemId" = ${input.registrationItemId}
        WHERE "id" = ${item.id}
      `;
    }

    await recordVersion(
      { entityType: "AdditionalPrintItem", entityId: item.id, action: "CREATE", afterData: item, operatorName },
      tx
    );

    return item;
  };
  const created = db ? await runCreate(db) : await prisma.$transaction(runCreate);

  return { ok: true, item: created };
}

/**
 * V30.3c 額外增加寶袋的**唯一**建立入口（共用服務）。從某一筆已建立牌位（entryId）底下
 * 「增加寶袋」時呼叫；在**同一 transaction** 建立三筆互相關聯的正式資料：
 *   1. US_POCKET_EXTRA RitualRegistrationItem（收費與否都建立；amountDue＝是否收費?小計:0）＋registrationOrder。
 *   2. POCKET AdditionalPrintItem（isExtra=true，sourceEntryId＝該依附牌位 entry，收費旗標沿用輸入）。
 *   3. AdditionalPrintItem.registrationItemId＝步驟 1 的報名項目 id。
 *
 * 收款唯一來源＝步驟 1 的 RitualRegistrationItem（見 receivableAdapters 的 US_POCKET_EXTRA adapter）；
 * 步驟 2 因帶 registrationItemId，legacy AdditionalPrintItem 應收 adapter 會排除，避免重複計價。
 * 不勾選收費（isChargeable=false）→ amountDue=0、不產生應收，但仍建立可列印／可補印的寶袋列印物件。
 */
export async function createExtraPocket(
  householdId: string,
  year: number,
  entryId: string,
  input: {
    usesSourceName: boolean;
    customPrintName?: string | null;
    quantity: number;
    note?: string | null;
    isChargeable?: boolean;
    unitPrice?: number | null;
  },
  operatorName?: string | null
): Promise<AdditionalPrintItemMutationResult> {
  const context = await resolveEntryContext(entryId);
  if (!context || context.householdId !== householdId || context.year !== year) {
    return { ok: false, status: 404, error: "找不到這筆普渡登記項目" };
  }
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    return { ok: false, status: 400, error: "數量必須是至少 1 的整數" };
  }

  // 收費與小計（沿用既有寶袋計價三層來源；不收費 → 小計 0、不建立應收）。
  const isChargeable = input.isChargeable ?? true;
  let unitPrice = input.unitPrice ?? null;
  if (isChargeable && (unitPrice === null || unitPrice === undefined)) {
    const activity = context.templeEventId
      ? await prisma.templeEvent.findUnique({ where: { id: context.templeEventId }, select: { pocketUnitPrice: true } })
      : null;
    unitPrice = resolvePocketUnitPrice(activity?.pocketUnitPrice ? Number(activity.pocketUnitPrice) : null);
  }
  const feeResult = computePocketSubtotal({ isChargeable, unitPrice, quantity: input.quantity });
  if (!feeResult.ok) {
    return { ok: false, status: 400, error: feeResult.error };
  }
  const amountDue = isChargeable ? feeResult.subtotal : 0;

  return prisma.$transaction(async (tx) => {
    // 1) 先建立本寶袋自身的 US_POCKET_EXTRA 報名項目（唯一收款來源＋registrationOrder）。
    const reg = await createPocketRegistrationItem(tx, {
      ritualRecordId: context.ritualRecordId,
      memberId: null, // 寶袋以家戶為收款單位，比照既有額外寶袋
      quantity: input.quantity,
      amountDue,
    });
    // 2)+3) 建立 POCKET 列印物件並連結 registrationItemId（createAdditionalPrintItem 內於同一 tx 寫入）。
    return createAdditionalPrintItem(
      householdId,
      year,
      entryId,
      {
        itemType: AdditionalPrintItemType.POCKET,
        usesSourceName: input.usesSourceName,
        customPrintName: input.customPrintName ?? null,
        quantity: input.quantity,
        isExtra: true,
        note: input.note ?? null,
        isChargeable,
        unitPrice,
        registrationItemId: reg.id,
      },
      operatorName,
      tx
    );
  });
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
/**
 * V30.3c 寶袋生命週期一致：讀出一筆寶袋列印物件連結的 US_POCKET_EXTRA 報名項目（若有）及其
 * 已收金額。取消／刪除前用來擋「報名項目已收款」的孤兒帳；取消／刪除／恢復時同步報名項目狀態。
 * registrationItemId 以 raw SQL 讀（client 未 regenerate）。回 null＝無連結（基本 legacy 或牌位物件）。
 */
async function getLinkedPocketRegistration(
  itemId: string,
  db: DbClient = prisma
): Promise<{ id: string; amountPaid: number; amountDue: number } | null> {
  const rows = await db.$queryRaw<{ regId: string | null }[]>`
    SELECT "registrationItemId" AS "regId" FROM "additional_print_items" WHERE "id" = ${itemId}
  `;
  const regId = rows[0]?.regId ?? null;
  if (!regId) return null;
  const reg = await db.ritualRegistrationItem.findUnique({
    where: { id: regId },
    select: { amountPaid: true, amountDue: true },
  });
  if (!reg) return null;
  return { id: regId, amountPaid: Number(reg.amountPaid), amountDue: Number(reg.amountDue) };
}

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

  // V30.3c：新式寶袋的應收在其 US_POCKET_EXTRA 報名項目上——若該報名項目已收款，同樣不得直接取消。
  const linkedReg = await getLinkedPocketRegistration(itemId);
  if (linkedReg && linkedReg.amountPaid > 0) {
    const linkedGuard = assertNoPaymentBeforeRemoval(linkedReg.amountPaid, "取消");
    if (linkedGuard.ok === false) return { ok: false, status: 409, error: linkedGuard.error };
  }

  if (existing.status === "CANCELLED") {
    return { ok: false, status: 400, error: "這筆項目已經是取消狀態" };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
    // 同步取消連結的寶袋報名項目（不重新編號，保留 registrationOrder），並自待收款移除。
    if (linkedReg) {
      await tx.ritualRegistrationItem.update({
        where: { id: linkedReg.id },
        data: { status: "CANCELLED", amountUnpaid: 0 },
      });
    }
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

  // V30.3c：連結的寶袋報名項目若已收款同樣禁止刪除（避免留下仍計費／已收款的孤兒報名項目）。
  const linkedRegDel = await getLinkedPocketRegistration(itemId);
  if (linkedRegDel && linkedRegDel.amountPaid > 0) {
    const g = assertNoPaymentBeforeRemoval(linkedRegDel.amountPaid, "刪除");
    if (g.ok === false) return { ok: false, status: 409, error: g.error };
  }

  const updated = await prisma.$transaction(async (tx) => {
    const after = await tx.additionalPrintItem.update({
      where: { id: itemId },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });
    // 同步軟刪除連結的寶袋報名項目（保留 registrationOrder，自待收款移除），不留計費孤兒。
    if (linkedRegDel) {
      await tx.ritualRegistrationItem.update({
        where: { id: linkedRegDel.id },
        data: { deletedAt: new Date(), status: "CANCELLED", amountUnpaid: 0, deletedByName: operatorName?.trim() || null },
      });
    }
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
    // V30.3c：同步恢復連結的寶袋報名項目（保留原 registrationOrder，不重新編號）；
    // 依所屬 RitualRecord 狀態決定 DRAFT／CONFIRMED，重回待收款（amountUnpaid＝amountDue）。
    const linkedRegRestore = await getLinkedPocketRegistration(itemId, tx);
    if (linkedRegRestore) {
      const rec = await tx.ritualRecord.findUnique({ where: { id: context.ritualRecordId }, select: { status: true } });
      const recStatus = rec?.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT";
      await tx.ritualRegistrationItem.update({
        where: { id: linkedRegRestore.id },
        data: { status: recStatus, deletedAt: null, deletedByName: null, amountUnpaid: linkedRegRestore.amountDue },
      });
    }
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
/**
 * V30.3c 寶袋統一編號來源：為「一個寶袋列印物件」建立其對應的 US_POCKET_EXTRA
 * RitualRegistrationItem，並套用**既有** registrationOrder 架構（同一 advisory lock／unique
 * index／(templeEventId, US_POCKET_EXTRA) 範圍）。基本寶袋與額外寶袋共用**同一條**寶袋序號序列，
 * 不另建第二套編號。
 *
 * - 基本寶袋：amountDue=0（永遠免費，收款 adapter 以 subtotal>0 過濾自然排除）。
 * - 額外寶袋：amountDue＝是否收費 ? 小計 : 0；收費與否都建立本報名項目與列印物件。
 * - 一律不呼叫 linkItemToExistingDetail（寶袋連結走 AdditionalPrintItem.registrationItemId，非 linkedEntryId）。
 * - 回傳新建報名項目 id，供 AdditionalPrintItem.registrationItemId 於同一 tx 連結。
 *
 * 必須在建立寶袋列印物件的**同一 transaction** 內呼叫。
 */
export async function createPocketRegistrationItem(
  tx: Prisma.TransactionClient,
  params: {
    ritualRecordId: string;
    memberId?: string | null;
    quantity: number;
    amountDue: number;
  }
): Promise<{ id: string; registrationOrder: number | null }> {
  const pocketType = await tx.registrationItemType.findUnique({
    where: { key: "US_POCKET_EXTRA" },
    select: { id: true },
  });
  if (!pocketType) {
    throw new Error("找不到『增加寶袋（US_POCKET_EXTRA）』報名項目設定，無法建立寶袋報名。");
  }
  const amount = Math.max(0, Math.round(params.amountDue * 100) / 100);
  // 應收計時比照 legacy 寶袋：以所屬 RitualRecord 狀態為準（記錄已 CONFIRMED → 本項亦 CONFIRMED
  // 立即進待收款；DRAFT → 不進待收款）。basic 寶袋 amountDue=0，狀態不影響（永遠 0 應收）。
  const rec = await tx.ritualRecord.findUnique({
    where: { id: params.ritualRecordId },
    select: { status: true },
  });
  const status = rec?.status === "CONFIRMED" ? "CONFIRMED" : "DRAFT";
  const created = await tx.ritualRegistrationItem.create({
    data: {
      ritualRecordId: params.ritualRecordId,
      registrationItemTypeId: pocketType.id,
      memberId: params.memberId ?? null,
      quantity: params.quantity,
      amountDue: amount,
      amountPaid: 0,
      amountUnpaid: amount,
      feeChoice: null,
      status,
    },
    select: { id: true },
  });
  // 既有正式編號架構：同一 tx advisory lock + max+1 + unique index（不改防併發規則）。
  const registrationOrder = await applyRegistrationOrder(tx, created.id, params.ritualRecordId, pocketType.id);
  return { id: created.id, registrationOrder };
}

export async function ensureTabletPrintObjects(
  input: EnsureTabletPrintObjectsInput,
  client: Prisma.TransactionClient | typeof prisma = prisma
): Promise<{ createdTablet: boolean; createdPocket: boolean }> {
  // V34.3B：一併查出「已封存（deletedAt 非 null）」的預設列印物件，讓重新報名時**恢復**同一筆，
  //   而不是又建立一筆新的（與 deleteUniversalSalvationEntry 的封存連動對稱，避免孤立/重複列印物件）。
  const existing = await client.additionalPrintItem.findMany({
    where: {
      sourceEntryId: input.sourceEntryId,
      sourceEntryType: "UNIVERSAL_SALVATION_ENTRY",
      isExtra: false,
      itemType: { in: [AdditionalPrintItemType.TABLET, AdditionalPrintItemType.POCKET] },
    },
    select: { id: true, itemType: true, deletedAt: true },
    orderBy: { createdAt: "asc" },
  });
  const activeTablet = existing.find((e) => e.itemType === AdditionalPrintItemType.TABLET && !e.deletedAt);
  const activePocket = existing.find((e) => e.itemType === AdditionalPrintItemType.POCKET && !e.deletedAt);
  const softTablet = existing.find((e) => e.itemType === AdditionalPrintItemType.TABLET && e.deletedAt);
  const softPocket = existing.find((e) => e.itemType === AdditionalPrintItemType.POCKET && e.deletedAt);
  const hasTablet = !!activeTablet;
  const hasPocket = !!activePocket;

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
    if (softTablet) {
      // 恢復先前封存的同一筆 TABLET 列印物件（保留列印歷史／id），不新增重複。
      await client.additionalPrintItem.update({ where: { id: softTablet.id }, data: { deletedAt: null, deletedByName: null } });
    } else {
      await client.additionalPrintItem.create({ data: { ...base, itemType: AdditionalPrintItemType.TABLET } });
    }
    createdTablet = true;
  }
  if (!hasPocket && softPocket) {
    // 恢復先前封存的同一筆 POCKET 列印物件（其 registrationItemId／寶袋報名項目沿用，不新增第二筆）。
    await client.additionalPrintItem.update({ where: { id: softPocket.id }, data: { deletedAt: null, deletedByName: null } });
    createdPocket = true;
  } else if (!hasPocket) {
    const pocket = await client.additionalPrintItem.create({
      data: { ...base, itemType: AdditionalPrintItemType.POCKET },
      select: { id: true },
    });
    // V30.3c：基本寶袋也取得自己的 registrationOrder／作業號碼——建立一筆 US_POCKET_EXTRA
    // 報名項目（amountDue=0 永遠免費）並以 registrationItemId 連結，與額外寶袋共用同一寶袋序號序列。
    const reg = await createPocketRegistrationItem(client as Prisma.TransactionClient, {
      ritualRecordId: input.ritualRecordId,
      memberId: input.memberId ?? null,
      quantity: 1,
      amountDue: 0,
    });
    await (client as Prisma.TransactionClient).$executeRaw`
      UPDATE "additional_print_items" SET "registrationItemId" = ${reg.id} WHERE "id" = ${pocket.id}
    `;
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
  /**
   * V30.3 普渡報名順序：此列印品來源牌位對應報名項目的 registrationOrder（各活動×項目各自 1 起）。
   * 列印管理／正式列印／補印查詢一律以此排序；牌位「作業號碼 No.<registrationOrder>」也用此值。
   * 舊資料未補號時為 null（排在最後）。
   */
  registrationOrder: number | null;
  sourceCategory: string;
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  /** V32 單筆列印主文覆寫（有值＝列印引擎直接採用；null＝用系統預設 sourceDisplayName 經 formatter）。 */
  printMainText: string | null;
  itemType: string;
  printName: string;
  /** V36.5B：是否沿用來源牌位名稱（false＝額外寶袋填了自訂姓名，如「江士耀」）。列印時據此決定寶袋主文。 */
  usesSourceName: boolean;
  quantity: number;
  isExtra: boolean;
  status: AdditionalPrintItemStatusValue;
  isPrinted: boolean;
  printedQuantity: number;
  note: string | null;
  /**
   * V27.9：跨家戶批次牌位 PDF（沿用 UNIVERSAL_SALVATION_TABLET_A4_V1）所需的牌位版面欄位。
   * 內容全部來自來源牌位（UniversalSalvationEntry），此處純唯讀帶出、不新增資料表/路由。
   */
  // 列印牌位地址（與 getUniversalSalvationPrintData 一致：優先自身 tabletAddress，缺則回退共用 WorshipRecord 地址）。
  sourceLocation: string | null;
  // 完整度檢查用的**原始** tabletAddress（與 completenessGate 讀取的 entry.tabletAddress 同源，供缺漏比對一致）。
  sourceTabletAddress: string | null;
  sourceYangshangName: string | null;
  sourceYangshangNames: string[];
  /**
   * 牌位資料缺漏欄位（如「陽上人」「牌位地址」）。空陣列＝可正式列印。
   * 由 dataCompleteness.tabletMissingFieldsForCategory 計算——直接沿用完整度 gate 的
   * checkUniversalSalvationItem，與「完成正式列印」422 判定天然一致。
   */
  tabletMissingFields: string[];
  // V14.4 列印物件層：
  printCount: number;
  firstPrintedAt: string | null;
  lastPrintedAt: string | null;
  lastPrintedByUserId: string | null;
  lastPrintedByName: string | null;
  /**
   * V32 §5 需補印：已列印（printCount>0）且首次列印後內容又被修改
   * （workOrder／printMainText／tabletAddress／陽上人／牌位名稱／寶袋指定名稱）→ true。
   * 預覽不解除；只有實際「確認完成列印（補印）」把 lastPrintedAt 推到編輯之後才解除。
   */
  needsReprint: boolean;
};

/**
 * 普渡列印中心（需求「九」）：跨家戶依年度查詢，可依活動/家戶/報名人/原
 * 祭祀類型/原祭祀名稱/寶袋列印名稱/預設額外/待列印已列印篩選。
 *
 * sourceEntryId 不是強制 FK（見 schema.prisma 說明），這裡分兩步查詢：
 * 先查符合條件的 AdditionalPrintItem，再一次把對應的 UniversalSalvationEntry
 * 撈出來合併，避免對每一筆都各自查一次資料庫。
 */

// V30.3 寶袋順序防誤取規則：定義在 client-safe 的 TabletBatchService（不 import Prisma，便於單元測試），
// 已於檔首 import；此處 re-export 供既有呼叫端沿用同一入口。詳見該函式 docstring。
export { registrationOrderForPrintItem };

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

  const itemsRaw = await prisma.additionalPrintItem.findMany({
    where,
    include: { household: true },
    orderBy: [{ createdAt: "desc" }],
  });

  // V32 阻擋修正：列印物件層唯一性——同一 (sourceEntryId, itemType) 的預設物件（isExtra=false）只保留一筆，
  // 避免遺留重複列導致冤親等牌位在列印管理／正式列印重複出現、印兩張。額外寶袋（isExtra=true）不受影響。
  const items = dedupeDefaultPrintObjects(itemsRaw);

  const sourceEntryIds = [...new Set(items.map((i) => i.sourceEntryId))];
  const sourceEntries = sourceEntryIds.length
    ? await prisma.universalSalvationEntry.findMany({
        // V34.3B：來源牌位若已封存（deletedAt 非 null）不得進列印清單——只取未封存的牌位，
        //   封存牌位不在此 Map，組裝時的 `if (!source) continue` 會直接跳過其列印物件（TABLET／POCKET 皆然）。
        where: { id: { in: sourceEntryIds }, deletedAt: null },
        // V27.9：列印牌位地址在缺自身 tabletAddress 時回退共用 WorshipRecord.location（同 getUniversalSalvationPrintData）。
        include: { worshipRecord: { select: { location: true } } },
      })
    : [];
  const sourceEntryById = new Map(sourceEntries.map((e) => [e.id, e]));

  // V36.10：**明確**查出本批中已封存（deletedAt 非 null）的來源牌位 id——即使其 AdditionalPrintItem
  //   尚未連動封存（例：牌位以非正式流程封存、或連動漏跑），仍一律不得進名冊／列印。
  //   與上方 `deletedAt: null` 的隱性排除互為雙保險，並可被回歸測試明確驗證。
  const archivedSourceEntryIds = sourceEntryIds.length
    ? new Set(
        (
          await prisma.universalSalvationEntry.findMany({
            where: { id: { in: sourceEntryIds }, deletedAt: { not: null } },
            select: { id: true },
          })
        ).map((e) => e.id)
      )
    : new Set<string>();

  // V34.3B：來源牌位對應的 1:1 報名項目（universalSalvationEntryId 為 @unique）——
  //   含已刪除與 CANCELLED 皆查出（不加 deletedAt 過濾），供組裝時排除「已取消／已刪除報名」的孤立列印物件。
  const linkedRriRows = sourceEntryIds.length
    ? await prisma.$queryRaw<{ eid: string; status: string; del: Date | null }[]>`
        SELECT "universalSalvationEntryId" AS eid, "status" AS status, "deletedAt" AS del
        FROM "ritual_registration_items"
        WHERE "universalSalvationEntryId" IN (${Prisma.join(sourceEntryIds)})`
    : [];
  const linkedRriByEntryId = new Map(linkedRriRows.map((r) => [r.eid, { status: String(r.status), deleted: r.del != null }]));

  // V30.3：**牌位（TABLET）**用——來源牌位（UniversalSalvationEntry）對應報名項目的
  // registrationOrder（raw SQL；不依賴 Prisma client 是否已 regenerate）。寶袋不走這條（見下）。
  const orderRows = sourceEntryIds.length
    ? await prisma.$queryRaw<{ eid: string; ro: number | null; wo: number | null; ua: Date | null }[]>`
        SELECT "universalSalvationEntryId" AS eid, "registrationOrder" AS ro, "workOrder" AS wo, "updatedAt" AS ua
        FROM "ritual_registration_items"
        WHERE "universalSalvationEntryId" IN (${Prisma.join(sourceEntryIds)}) AND "deletedAt" IS NULL
      `
    : [];
  // V32：牌位 No.xxx＝printNumberOf(workOrder, registrationOrder)。
  const tabletOrderByEntryId = new Map(orderRows.map((r) => [r.eid, printNumberOf(r.wo, r.ro)]));
  // V32 §5：牌位對應 RRI 的 updatedAt（workOrder 改號亦更新它）→ 供 needsReprint。
  const tabletRriUpdatedByEntryId = new Map(orderRows.map((r) => [r.eid, r.ua ? new Date(r.ua).toISOString() : null]));

  // V30.3b：**寶袋（POCKET）**用——由 AdditionalPrintItem.registrationItemId 取自身「增加寶袋」
  // US_POCKET_EXTRA 報名項目的 registrationOrder。分兩步 raw SQL（client 未 regenerate）：
  //   (1) 讀每筆列印物件的 registrationItemId；(2) 對非 null 的 id 查報名項目的 key＋registrationOrder。
  // 只保留 key=US_POCKET_EXTRA 者；讀取端 resolver 對非該型別／找不到／null 一律回 null，絕不 fallback 牌位。
  const itemIds = items.map((i) => i.id);
  const printItemRegRows = itemIds.length
    ? await prisma.$queryRaw<{ id: string; regId: string | null }[]>`
        SELECT "id", "registrationItemId" AS "regId"
        FROM "additional_print_items"
        WHERE "id" IN (${Prisma.join(itemIds)})
      `
    : [];
  const registrationItemIdByPrintItem = new Map(printItemRegRows.map((r) => [r.id, r.regId]));
  const pocketRegIds = [...new Set(printItemRegRows.map((r) => r.regId).filter((x): x is string => !!x))];
  const pocketRegRows = pocketRegIds.length
    ? await prisma.$queryRaw<{ id: string; itemKey: string; ro: number | null; wo: number | null; ua: Date | null }[]>`
        SELECT rri."id", rit."key" AS "itemKey", rri."registrationOrder" AS ro, rri."workOrder" AS wo, rri."updatedAt" AS ua
        FROM "ritual_registration_items" rri
        JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
        WHERE rri."id" IN (${Prisma.join(pocketRegIds)}) AND rri."deletedAt" IS NULL
      `
    : [];
  // V32：寶袋 No.xxx＝printNumberOf(workOrder, registrationOrder)（寶袋自身 US_POCKET_EXTRA 序列）。
  const pocketRegistrationById = new Map(
    pocketRegRows.map((r) => [r.id, { itemKey: r.itemKey, registrationOrder: printNumberOf(r.wo, r.ro) }])
  );
  // V32 §5：寶袋對應 RRI 的 updatedAt → 供 needsReprint。
  const pocketRriUpdatedById = new Map(pocketRegRows.map((r) => [r.id, r.ua ? new Date(r.ua).toISOString() : null]));

  // V14.4：解析最後列印操作人姓名（lastPrintedByUserId → User.name）。
  const lastPrintedByUserIds = [
    ...new Set(items.map((i) => i.lastPrintedByUserId).filter((x): x is string => !!x)),
  ];
  const users = lastPrintedByUserIds.length
    ? await prisma.user.findMany({ where: { id: { in: lastPrintedByUserIds } }, select: { id: true, name: true } })
    : [];
  const userNameById = new Map(users.map((u) => [u.id, u.name]));

  // V32：單筆列印主文覆寫（printMainText，raw SQL）＋ 地址 Member.address fallback。
  const pmtRows = sourceEntryIds.length
    ? await prisma.$queryRaw<{ id: string; pmt: string | null }[]>`
        SELECT "id", "printMainText" AS pmt FROM "universal_salvation_entries" WHERE "id" IN (${Prisma.join(sourceEntryIds)})`
    : [];
  const printMainTextByEntry = new Map(pmtRows.map((r) => [r.id, r.pmt]));
  const memberIds2 = [...new Set(items.map((i) => i.memberId).filter((x): x is string => !!x))];
  // V36.12：一併取 householdId——地址退回只採「同一家戶」信眾，避免跨戶退回成別戶地址。
  const memberById2 = memberIds2.length
    ? new Map((await prisma.member.findMany({ where: { id: { in: memberIds2 } }, select: { id: true, address: true, householdId: true } })).map((m) => [m.id, m]))
    : new Map<string, { id: string; address: string | null; householdId: string }>();

  const views: PrintCenterItemView[] = [];
  for (const item of items) {
    // V36.10：已封存來源牌位 → 立即跳過（即使其 AdditionalPrintItem 尚未封存）。
    if (archivedSourceEntryIds.has(item.sourceEntryId)) continue;
    const source = sourceEntryById.get(item.sourceEntryId);
    // V34.3B：來源牌位查無／已封存、或其 1:1 報名項目已刪除／CANCELLED → 一律排除（TABLET 與 POCKET 皆然）。
    const linkedRri = linkedRriByEntryId.get(item.sourceEntryId);
    if (
      shouldExcludeLeakedPrintSource({
        sourceExists: !!source,
        sourceDeletedAt: source?.deletedAt ?? null,
        registrationItemStatus: linkedRri?.status ?? null,
        registrationItemDeleted: linkedRri?.deleted ?? false,
      })
    ) {
      continue;
    }
    if (!source) continue; // 型別窄化（上方已排除 source 不存在的情況）。

    const sourceYangshangNames = resolveYangshangNames(source.yangshangNames, source.yangshangName);
    const tabletMissingFields = tabletMissingFieldsForCategory(source.category, sourceYangshangNames, source.tabletAddress);

    if (filters.sourceCategory && source.category !== filters.sourceCategory) continue;
    if (filters.sourceName && !source.displayName.includes(filters.sourceName)) continue;
    if (
      filters.registrantName &&
      !source.displayName.includes(filters.registrantName) &&
      !(source.yangshangName ?? "").includes(filters.registrantName)
    ) {
      continue;
    }

    // V32 §5 需補印：彙整此列印物件的「內容最後變更時間」。
    //   entry.updatedAt   → 牌位名稱／陽上人／地址／printMainText（含 raw SQL 已同步 updatedAt）
    //   item.updatedAt    → 寶袋指定名稱（printName）等列印物件本身變更
    //   RRI.updatedAt     → workOrder 改號（TABLET 取牌位 RRI；POCKET 取自身 US_POCKET_EXTRA RRI）
    const rriUpdated =
      item.itemType === "TABLET"
        ? tabletRriUpdatedByEntryId.get(item.sourceEntryId) ?? null
        : pocketRriUpdatedById.get(registrationItemIdByPrintItem.get(item.id) ?? "") ?? null;
    const editedAt = latestIso(
      source.updatedAt ? source.updatedAt.toISOString() : null,
      item.updatedAt ? item.updatedAt.toISOString() : null,
      rriUpdated
    );
    const lastPrintedAtIso = (item.lastPrintedAt ?? item.printedAt) ? (item.lastPrintedAt ?? item.printedAt)!.toISOString() : null;
    const itemNeedsReprint = computeNeedsReprint(item.printCount ?? 0, lastPrintedAtIso, editedAt);

    views.push({
      id: item.id,
      household: { id: item.household.id, name: item.household.name },
      sourceEntryId: item.sourceEntryId,
      // V30.3b 作業號碼／順序來源（唯一規則見 resolvePrintItemRegistrationOrder）：
      //   TABLET → 由 sourceEntry 對應牌位報名項目取號；
      //   POCKET → 只由自身 registrationItemId → US_POCKET_EXTRA 報名項目取號，否則 null，
      //            **絕不**沿用 sourceEntry（依附牌位：祖先／乙位／冤親／無緣）的號碼。
      registrationOrder: resolvePrintItemRegistrationOrder(
        {
          itemType: item.itemType,
          sourceEntryId: item.sourceEntryId,
          registrationItemId: registrationItemIdByPrintItem.get(item.id) ?? null,
        },
        { tabletOrderByEntryId, pocketRegistrationById }
      ),
      sourceCategory: source.category,
      sourceCategoryLabel: universalSalvationEntryCategoryLabel[source.category] ?? source.category,
      // V33.1：完整顯示名稱一律經共用 resolver（type 依 category 欄位，不猜名稱）——
      // 列印管理／作業編號／補印搜尋／寶袋來源牌位名稱皆用此一致值。
      sourceDisplayName: resolveRitualDisplayName(source.category, source.displayName),
      // V32 單筆列印主文覆寫（有值時列印引擎直接採用、不再套 formatter；空白＝用系統預設主文）。
      printMainText: (printMainTextByEntry.get(item.sourceEntryId) ?? "").trim() || null,
      itemType: item.itemType,
      printName: item.printName,
      usesSourceName: item.usesSourceName,
      quantity: item.quantity,
      isExtra: item.isExtra,
      status: item.status as AdditionalPrintItemStatusValue,
      isPrinted: item.isPrinted,
      printedQuantity: item.printedQuantity,
      note: item.note,
      // V32 地址唯一規則：entry.tabletAddress → Member.address（絕不 Household；不再用 worshipRecord.location）。
      // V36.12：Member.address 退回只採「同一家戶」信眾（member.householdId === 牌位家戶）；跨戶一律不退回，杜絕別戶地址。
      sourceLocation: resolvePrintAddress(
        source.tabletAddress,
        (() => {
          const m = item.memberId ? memberById2.get(item.memberId) : null;
          return m && m.householdId === item.household.id ? m.address : null;
        })()
      ) || null,
      sourceTabletAddress: source.tabletAddress ?? null,
      sourceYangshangName: source.yangshangName,
      sourceYangshangNames,
      tabletMissingFields,
      // V14.4 列印物件層欄位：
      printCount: item.printCount ?? 0,
      firstPrintedAt: (item.firstPrintedAt ?? item.printedAt) ? (item.firstPrintedAt ?? item.printedAt)!.toISOString() : null,
      lastPrintedAt: (item.lastPrintedAt ?? item.printedAt) ? (item.lastPrintedAt ?? item.printedAt)!.toISOString() : null,
      lastPrintedByUserId: item.lastPrintedByUserId ?? null,
      lastPrintedByName: item.lastPrintedByUserId ? userNameById.get(item.lastPrintedByUserId) ?? null : null,
      needsReprint: itemNeedsReprint,
    });
  }

  // V30.3：列印排序＝每類（sourceCategory）內依 registrationOrder 由小到大；未補號（null）排最後。
  // 換頁不重新編號（作業號碼＝registrationOrder，與此順序一致）。
  views.sort((a, b) => {
    if (a.sourceCategory !== b.sourceCategory) return a.sourceCategory < b.sourceCategory ? -1 : 1;
    const ao = a.registrationOrder;
    const bo = b.registrationOrder;
    if (ao == null && bo == null) return 0;
    if (ao == null) return 1;
    if (bo == null) return -1;
    return ao - bo;
  });

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
  /** V32 §5：此列印物件是否需補印。 */
  needsReprint: boolean;
  /** V32 §5 搜尋用：正式作業號（No.xxx＝printNumberOf 結果）。 */
  registrationOrder: number | null;
  /** V32 §5 搜尋用：單筆列印主文覆寫（供依牌位主文搜尋）。 */
  printMainText: string | null;
};

export type GroupedTabletPrintView = {
  sourceEntryId: string;
  household: { id: string; name: string };
  sourceCategoryLabel: string;
  sourceDisplayName: string;
  tablet: PrintObjectView | null;
  pocket: PrintObjectView | null;
  extras: PrintObjectView[];
  /**
   * V36.4：完整度缺漏欄位（直接沿用 listPrintItemsForPrintCenter 內、由完整度 gate
   * tabletMissingFieldsForCategory 計算的結果，同牌位的 TABLET／POCKET 共用）。空陣列＝完整。
   * 純唯讀透傳，不重算、不改完整度判斷。
   */
  tabletMissingFields: string[];
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
        // 直接透傳完整度 gate 的缺漏欄位（同牌位 TABLET／POCKET 共用；以牌位來源為準）。
        tabletMissingFields: it.tabletMissingFields,
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
      needsReprint: it.needsReprint,
      registrationOrder: it.registrationOrder,
      printMainText: it.printMainText,
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
