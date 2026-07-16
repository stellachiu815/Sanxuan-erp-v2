import { ActivityOfferingStatus, OfferingClaimMode, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { generateFloralOfferingSlots } from "@/lib/offeringRules";

/**
 * V10.1「供品認捐中心」需求「二、活動供品設定」核心邏輯。
 *
 * 任何宮務活動（TempleEvent：宮慶／四位主祀神明聖誕／普渡／其他法會）都
 * 可以從供品種類庫（OfferingType）加入需要的供品，每一筆 ActivityOffering
 * 都是「這個活動、這種供品」專屬的數量/價格/認捐期間設定，不同活動彼此
 * 完全獨立，互不影響（需求「二」明確要求）。
 *
 * behaviorKind=FLORAL 的供品種類，加入活動時會自動產生 24 筆
 * FloralOfferingSlot（需求「十」），其餘供品種類不會產生任何附屬名額列。
 */

export type ActivityOfferingResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function listActivityOfferings(templeEventId: string) {
  return prisma.activityOffering.findMany({
    where: { templeEventId },
    include: { offeringType: true },
    orderBy: [{ offeringType: { sortOrder: "asc" } }],
  });
}

export type AddActivityOfferingInput = {
  offeringTypeId: string;
  quantity?: number | null; // 未填時使用 OfferingType.defaultQuantity
  price?: number | null;
  useDefaultPrice?: boolean;
  allowPriceOverride?: boolean;
  hasLimitedQuantity?: boolean;
  isChargeable?: boolean;
  claimMode?: OfferingClaimMode;
  claimStartDate?: Date | null;
  claimEndDate?: Date | null;
  note?: string | null;
};

/**
 * 需求「二」：任一活動從供品種類庫加入需要的供品。同一活動、同一種供品
 * 只能設定一筆（@@unique([templeEventId, offeringTypeId])），重複加入視為
 * 修改既有設定，不會產生第二筆。
 */
export async function addActivityOffering(
  templeEventId: string,
  input: AddActivityOfferingInput,
  operatorName?: string | null
): Promise<ActivityOfferingResult<{ id: string }>> {
  const [event, offeringType] = await Promise.all([
    prisma.templeEvent.findUnique({ where: { id: templeEventId } }),
    prisma.offeringType.findUnique({ where: { id: input.offeringTypeId } }),
  ]);
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };
  if (!offeringType || !offeringType.isActive) {
    return { ok: false, status: 404, error: "找不到這個供品種類，或這個供品種類已停用" };
  }

  const existing = await prisma.activityOffering.findUnique({
    where: { templeEventId_offeringTypeId: { templeEventId, offeringTypeId: input.offeringTypeId } },
  });
  if (existing) {
    return { ok: false, status: 409, error: "這個活動已經加入過這種供品，請直接修改既有設定" };
  }

  const quantity = input.quantity ?? offeringType.defaultQuantity;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, status: 400, error: "數量請輸入正整數" };
  }

  const useDefaultPrice = input.useDefaultPrice ?? true;
  const claimMode = input.claimMode ?? offeringType.claimMode;

  const created = await prisma.$transaction(async (tx) => {
    const offering = await tx.activityOffering.create({
      data: {
        templeEventId,
        offeringTypeId: input.offeringTypeId,
        quantity,
        price: useDefaultPrice ? null : input.price ?? null,
        useDefaultPrice,
        allowPriceOverride: input.allowPriceOverride ?? offeringType.allowPriceOverride,
        hasLimitedQuantity: input.hasLimitedQuantity ?? offeringType.hasLimitedQuantity,
        isChargeable: input.isChargeable ?? offeringType.isChargeable,
        claimMode,
        claimStartDate: input.claimStartDate ?? null,
        claimEndDate: input.claimEndDate ?? null,
        note: input.note?.trim() || null,
      },
    });

    // 需求「十」：behaviorKind=FLORAL 的供品，加入活動時自動產生 24 筆名額。
    if (offeringType.behaviorKind === "FLORAL") {
      const seeds = generateFloralOfferingSlots();
      await tx.floralOfferingSlot.createMany({
        data: seeds.map((s) => ({
          activityOfferingId: offering.id,
          templeEventId,
          lunarMonth: s.lunarMonth,
          lunarDay: s.lunarDay,
          isLeapMonth: s.isLeapMonth,
          sortOrder: s.sortOrder,
        })),
      });
    }

    await recordVersion(
      { entityType: "ActivityOffering", entityId: offering.id, action: "CREATE", afterData: offering, operatorName },
      tx
    );
    return offering;
  });

  return { ok: true, data: { id: created.id } };
}

export type UpdateActivityOfferingInput = Partial<AddActivityOfferingInput> & {
  status?: ActivityOfferingStatus;
};

export async function updateActivityOffering(
  id: string,
  input: UpdateActivityOfferingInput,
  operatorName?: string | null
): Promise<ActivityOfferingResult<{ id: string }>> {
  const existing = await prisma.activityOffering.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆活動供品設定" };

  if (input.quantity !== undefined && input.quantity !== null) {
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, status: 400, error: "數量請輸入正整數" };
    }
  }

  const data: Prisma.ActivityOfferingUpdateInput = {};
  if (input.quantity !== undefined && input.quantity !== null) data.quantity = input.quantity;
  if (input.price !== undefined) data.price = input.price;
  if (input.useDefaultPrice !== undefined) data.useDefaultPrice = input.useDefaultPrice;
  if (input.allowPriceOverride !== undefined) data.allowPriceOverride = input.allowPriceOverride;
  if (input.hasLimitedQuantity !== undefined) data.hasLimitedQuantity = input.hasLimitedQuantity;
  if (input.isChargeable !== undefined) data.isChargeable = input.isChargeable;
  if (input.claimMode !== undefined) data.claimMode = input.claimMode;
  if (input.claimStartDate !== undefined) data.claimStartDate = input.claimStartDate;
  if (input.claimEndDate !== undefined) data.claimEndDate = input.claimEndDate;
  if (input.status !== undefined) data.status = input.status;
  if (input.note !== undefined) data.note = input.note?.trim() || null;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.activityOffering.update({ where: { id }, data });
    await recordVersion(
      { entityType: "ActivityOffering", entityId: id, action: "UPDATE", beforeData: existing, afterData: u, operatorName },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

export async function removeActivityOffering(
  id: string,
  operatorName?: string | null
): Promise<ActivityOfferingResult<{ id: string }>> {
  const existing = await prisma.activityOffering.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆活動供品設定" };

  const claimCount = await prisma.offeringClaim.count({
    where: { activityOfferingId: id, deletedAt: null, status: { not: "CANCELLED" } },
  });
  if (claimCount > 0) {
    return { ok: false, status: 409, error: "這個供品已經有認捐資料，請先處理完認捐資料再移除設定" };
  }

  await prisma.$transaction(async (tx) => {
    await recordVersion(
      { entityType: "ActivityOffering", entityId: id, action: "DELETE", beforeData: existing, operatorName },
      tx
    );
    await tx.floralOfferingSlot.deleteMany({ where: { activityOfferingId: id } });
    await tx.activityOffering.delete({ where: { id } });
  });
  return { ok: true, data: { id } };
}

// ============================================================
// 花果供品排程管理（需求「十」：管理者可新增/停用/修改個別日期）
// ============================================================

export async function listFloralOfferingSlots(activityOfferingId: string) {
  return prisma.floralOfferingSlot.findMany({
    where: { activityOfferingId },
    orderBy: { sortOrder: "asc" },
  });
}

export async function setFloralSlotActive(
  slotId: string,
  isActive: boolean
): Promise<ActivityOfferingResult<{ id: string }>> {
  const existing = await prisma.floralOfferingSlot.findUnique({ where: { id: slotId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個花果供品日期名額" };
  await prisma.floralOfferingSlot.update({ where: { id: slotId }, data: { isActive } });
  return { ok: true, data: { id: slotId } };
}

/** 需求「十一」：修改單筆花果供品價格，不影響其他 23 筆。 */
export async function setFloralSlotPriceOverride(
  slotId: string,
  priceOverride: number | null
): Promise<ActivityOfferingResult<{ id: string }>> {
  const existing = await prisma.floralOfferingSlot.findUnique({ where: { id: slotId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個花果供品日期名額" };
  await prisma.floralOfferingSlot.update({ where: { id: slotId }, data: { priceOverride } });
  return { ok: true, data: { id: slotId } };
}

/** 需求「十」：管理者新增一筆額外的花果供品日期（例如遇到閏月調整）。 */
export async function addFloralOfferingSlot(
  activityOfferingId: string,
  lunarMonth: number,
  lunarDay: number,
  isLeapMonth = false,
  note?: string | null
): Promise<ActivityOfferingResult<{ id: string }>> {
  if (!Number.isInteger(lunarMonth) || lunarMonth < 1 || lunarMonth > 12) {
    return { ok: false, status: 400, error: "農曆月份請輸入 1 到 12 之間" };
  }
  if (!Number.isInteger(lunarDay) || lunarDay < 1 || lunarDay > 30) {
    return { ok: false, status: 400, error: "農曆日期請輸入 1 到 30 之間" };
  }
  const offering = await prisma.activityOffering.findUnique({ where: { id: activityOfferingId } });
  if (!offering) return { ok: false, status: 404, error: "找不到這個活動供品設定" };

  const existing = await prisma.floralOfferingSlot.findUnique({
    where: {
      activityOfferingId_lunarMonth_lunarDay_isLeapMonth: {
        activityOfferingId,
        lunarMonth,
        lunarDay,
        isLeapMonth,
      },
    },
  });
  if (existing) return { ok: false, status: 409, error: "這個農曆日期已經存在" };

  const maxSortOrder = await prisma.floralOfferingSlot.aggregate({
    where: { activityOfferingId },
    _max: { sortOrder: true },
  });
  const created = await prisma.floralOfferingSlot.create({
    data: {
      activityOfferingId,
      templeEventId: offering.templeEventId,
      lunarMonth,
      lunarDay,
      isLeapMonth,
      sortOrder: (maxSortOrder._max.sortOrder ?? -1) + 1,
      note: note?.trim() || null,
    },
  });
  return { ok: true, data: { id: created.id } };
}

// ============================================================
// 需求「十九、年度複製」：建立下一年度活動時，複製供品設定與花果排程。
// ============================================================

/**
 * 複製上一年度的供品設定到新建立的活動年度（需求「十九」）：複製供品種類
 * 選用清單、預設數量、預設價格、名額規則、24 次花果供品日期；不複製去年
 * 認捐人、福壽龜得主、收款、收據——這幾項本來就不在 ActivityOffering /
 * FloralOfferingSlot 資料表裡，只要不去複製 OfferingClaim/OfferingPayment
 * 就自然不會複製到。呼叫時機：src/lib/templeEvents.ts 的
 * copyTempleEventFromPrevious() 建立好新的 TempleEvent 之後呼叫這支函式。
 */
export async function copyActivityOfferingsForNewEvent(
  sourceEventId: string,
  newEventId: string
): Promise<{ copiedOfferingCount: number; copiedSlotCount: number }> {
  const sourceOfferings = await prisma.activityOffering.findMany({
    where: { templeEventId: sourceEventId },
    include: { floralSlots: true },
  });

  let copiedOfferingCount = 0;
  let copiedSlotCount = 0;

  for (const source of sourceOfferings) {
    const created = await prisma.activityOffering.create({
      data: {
        templeEventId: newEventId,
        offeringTypeId: source.offeringTypeId,
        quantity: source.quantity,
        price: source.price,
        useDefaultPrice: source.useDefaultPrice,
        allowPriceOverride: source.allowPriceOverride,
        hasLimitedQuantity: source.hasLimitedQuantity,
        isChargeable: source.isChargeable,
        claimMode: source.claimMode,
        claimStartDate: null, // 認捐期間不沿用，需要新年度重新設定
        claimEndDate: null,
        note: source.note,
      },
    });
    copiedOfferingCount += 1;

    if (source.floralSlots.length > 0) {
      await prisma.floralOfferingSlot.createMany({
        data: source.floralSlots.map((slot) => ({
          activityOfferingId: created.id,
          templeEventId: newEventId,
          lunarMonth: slot.lunarMonth,
          lunarDay: slot.lunarDay,
          isLeapMonth: slot.isLeapMonth,
          sortOrder: slot.sortOrder,
          isActive: slot.isActive,
          priceOverride: slot.priceOverride,
          note: slot.note,
        })),
      });
      copiedSlotCount += source.floralSlots.length;
    }
  }

  return { copiedOfferingCount, copiedSlotCount };
}
