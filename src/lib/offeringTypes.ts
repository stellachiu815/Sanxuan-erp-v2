import { OfferingBehaviorKind, OfferingClaimMode, OfferingUnit, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V10.1「供品認捐中心」需求「一、供品種類管理」核心邏輯。
 *
 * 供品種類是「全域設定」（不綁定任何一個活動年度）——管理者可以自行新增、
 * 修改、停用、調整排序，程式碼裡不寫死任何供品名稱/數量/價格，見下方
 * DEFAULT_OFFERING_TYPES 只是「上線時的預設 seed 資料」，seed 完成後
 * 管理者一樣可以修改或停用這些預設供品種類。
 */

export type OfferingTypeResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

/**
 * 上線時預設建立的 5 種供品（需求「一」）。behaviorKind 決定這種供品是否
 * 套用特殊系統規則（壽龜一人一隻＋跨供品互斥、花果供品年度 24 筆排程），
 * 其餘欄位（單位/是否收費/是否限量/預設數量/預設價格……）都是可以事後
 * 調整的一般設定，不是寫死的行為。
 */
export const DEFAULT_OFFERING_TYPES: {
  name: string;
  category: string;
  behaviorKind: OfferingBehaviorKind;
  unit: OfferingUnit;
  isChargeable: boolean;
  hasLimitedQuantity: boolean;
  defaultQuantity: number;
  defaultPrice: number | null;
  allowPriceOverride: boolean;
  allowDuplicateClaim: boolean;
  claimMode: OfferingClaimMode;
  sortOrder: number;
}[] = [
  {
    name: "大福壽龜",
    category: "壽龜",
    behaviorKind: "TURTLE",
    unit: "ZHI",
    isChargeable: true,
    hasLimitedQuantity: true,
    defaultQuantity: 1,
    defaultPrice: null,
    allowPriceOverride: true,
    allowDuplicateClaim: false,
    claimMode: "INDIVIDUAL",
    sortOrder: 0,
  },
  {
    name: "小福壽龜",
    category: "壽龜",
    behaviorKind: "TURTLE",
    unit: "ZHI",
    isChargeable: true,
    hasLimitedQuantity: true,
    defaultQuantity: 6,
    defaultPrice: null,
    allowPriceOverride: true,
    allowDuplicateClaim: false,
    claimMode: "INDIVIDUAL",
    sortOrder: 1,
  },
  {
    name: "壽桃麵塔",
    category: "麵塔",
    behaviorKind: "NOODLE_TOWER",
    unit: "DUI",
    isChargeable: true,
    hasLimitedQuantity: true,
    defaultQuantity: 3,
    defaultPrice: null,
    allowPriceOverride: true,
    allowDuplicateClaim: true,
    claimMode: "INDIVIDUAL",
    sortOrder: 2,
  },
  {
    name: "散壽桃麵",
    category: "麵塔",
    behaviorKind: "LOOSE_PEACH",
    unit: "PAN",
    isChargeable: true,
    hasLimitedQuantity: true,
    defaultQuantity: 5,
    defaultPrice: null,
    allowPriceOverride: true,
    allowDuplicateClaim: true,
    claimMode: "INDIVIDUAL",
    sortOrder: 3,
  },
  {
    name: "花果供品",
    category: "花果",
    behaviorKind: "FLORAL",
    unit: "FEN",
    isChargeable: true,
    hasLimitedQuantity: true,
    defaultQuantity: 1,
    defaultPrice: 1500,
    allowPriceOverride: true,
    allowDuplicateClaim: true, // 同一人可以認捐不同農曆日期，用 floralSlotId 個別判斷是否重複，不是用這個欄位擋
    claimMode: "INDIVIDUAL",
    sortOrder: 4,
  },
];

/** 系統首次啟用時建立預設供品種類（需求「一」案例1/2/3）。已經存在同名資料就跳過，不會重複建立。 */
export async function seedDefaultOfferingTypes(operatorName?: string | null): Promise<void> {
  for (const def of DEFAULT_OFFERING_TYPES) {
    const existing = await prisma.offeringType.findFirst({ where: { name: def.name } });
    if (existing) continue;
    const created = await prisma.offeringType.create({ data: def });
    await recordVersion({
      entityType: "OfferingType",
      entityId: created.id,
      action: "CREATE",
      afterData: created,
      operatorName,
      changeNote: "系統預設供品種類",
    });
  }
}

export async function listOfferingTypes(includeInactive = true) {
  return prisma.offeringType.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });
}

export type OfferingTypeInput = {
  name: string;
  category?: string | null;
  behaviorKind?: OfferingBehaviorKind;
  unit?: OfferingUnit;
  isChargeable?: boolean;
  hasLimitedQuantity?: boolean;
  defaultQuantity?: number;
  defaultPrice?: number | null;
  allowPriceOverride?: boolean;
  allowDuplicateClaim?: boolean;
  claimMode?: OfferingClaimMode;
  sortOrder?: number;
  note?: string | null;
};

export async function createOfferingType(
  input: OfferingTypeInput,
  operatorName?: string | null
): Promise<OfferingTypeResult<{ id: string }>> {
  if (!input.name.trim()) return { ok: false, status: 400, error: "請輸入供品名稱" };
  const created = await prisma.offeringType.create({
    data: {
      name: input.name.trim(),
      category: input.category?.trim() || null,
      behaviorKind: input.behaviorKind ?? "GENERIC",
      unit: input.unit ?? "OTHER",
      isChargeable: input.isChargeable ?? true,
      hasLimitedQuantity: input.hasLimitedQuantity ?? true,
      defaultQuantity: input.defaultQuantity ?? 1,
      defaultPrice: input.defaultPrice ?? null,
      allowPriceOverride: input.allowPriceOverride ?? true,
      allowDuplicateClaim: input.allowDuplicateClaim ?? false,
      claimMode: input.claimMode ?? "INDIVIDUAL",
      sortOrder: input.sortOrder ?? 0,
      note: input.note?.trim() || null,
    },
  });
  await recordVersion({
    entityType: "OfferingType",
    entityId: created.id,
    action: "CREATE",
    afterData: created,
    operatorName,
  });
  return { ok: true, data: { id: created.id } };
}

export async function updateOfferingType(
  id: string,
  input: Partial<OfferingTypeInput> & { isActive?: boolean },
  operatorName?: string | null
): Promise<OfferingTypeResult<{ id: string }>> {
  const existing = await prisma.offeringType.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個供品種類" };

  const data: Prisma.OfferingTypeUpdateInput = {};
  if (input.name !== undefined) data.name = input.name.trim();
  if (input.category !== undefined) data.category = input.category?.trim() || null;
  if (input.behaviorKind !== undefined) data.behaviorKind = input.behaviorKind;
  if (input.unit !== undefined) data.unit = input.unit;
  if (input.isChargeable !== undefined) data.isChargeable = input.isChargeable;
  if (input.hasLimitedQuantity !== undefined) data.hasLimitedQuantity = input.hasLimitedQuantity;
  if (input.defaultQuantity !== undefined) data.defaultQuantity = input.defaultQuantity;
  if (input.defaultPrice !== undefined) data.defaultPrice = input.defaultPrice;
  if (input.allowPriceOverride !== undefined) data.allowPriceOverride = input.allowPriceOverride;
  if (input.allowDuplicateClaim !== undefined) data.allowDuplicateClaim = input.allowDuplicateClaim;
  if (input.claimMode !== undefined) data.claimMode = input.claimMode;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.note !== undefined) data.note = input.note?.trim() || null;
  if (input.isActive !== undefined) data.isActive = input.isActive;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.offeringType.update({ where: { id }, data });
    await recordVersion(
      { entityType: "OfferingType", entityId: id, action: "UPDATE", beforeData: existing, afterData: u, operatorName },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

/** 停用/啟用（需求「一」：管理者可自行停用，不是永久刪除，供品種類一旦被任何活動使用過就不應該真的刪除）。 */
export async function setOfferingTypeActive(
  id: string,
  isActive: boolean,
  operatorName?: string | null
): Promise<OfferingTypeResult<{ id: string }>> {
  return updateOfferingType(id, { isActive }, operatorName);
}

/** 調整排序（需求「一」）：一次提交完整的新順序（id 陣列，由前到後）。 */
export async function reorderOfferingTypes(
  orderedIds: string[],
  operatorName?: string | null
): Promise<OfferingTypeResult<{ count: number }>> {
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.offeringType.update({ where: { id }, data: { sortOrder: index } })
    )
  );
  void operatorName; // 排序調整屬於畫面操作便利性，不寫入版本紀錄（比照既有 Checklist sortOrder 慣例）
  return { ok: true, data: { count: orderedIds.length } };
}
