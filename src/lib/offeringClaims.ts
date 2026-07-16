import { OfferingClaimStatus, OfferingPaymentKind, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  checkDuplicateClaimConflict,
  checkTurtleExclusiveConflict,
  computeOfferingQuota,
  computeAmountDue,
  derivePaymentStatus,
  isCrossYearUnpaid,
  round2,
  type OfferingPaymentStatusValue,
} from "@/lib/offeringRules";

/**
 * V10.1「供品認捐中心」需求「三～九、十一、十三、十四、十八、二十」核心邏輯：
 * 認捐資料的新增/查詢/收款/取消/退款、跨年度未收款追蹤、信眾歷年查詢。
 *
 * 純規則（名額計算/收款狀態/跨供品互斥/花果日期格式）都在
 * src/lib/offeringRules.ts（不碰資料庫，可在沙盒真正測試），這裡負責串接
 * Prisma、既有的信眾/家戶資料、recordVersion（版本紀錄）與回收區機制。
 */

export type OfferingClaimResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

// ============================================================
// 一、新增認捐（需求「三」：認捐人必須優先從信眾中心搜尋並選取）
// ============================================================

export type CreateOfferingClaimInput = {
  activityOfferingId: string;
  sponsorMemberId: string; // 必填：一律要有真正的信眾主資料（查無資料時，由畫面先呼叫既有的新增信眾 API，取得 memberId 之後才呼叫這裡）
  floralSlotId?: string | null; // behaviorKind=FLORAL 時必填
  quantity?: number; // 未填時預設 1（GROUPED 模式的散壽桃麵，需求「九」，由呼叫端帶入整組的份數）
  unitPrice?: number | null; // 未填時使用花果單筆覆蓋價 → 活動當次價格 → 供品種類預設價格
  expectedPaymentDate?: Date | null;
  note?: string | null;
  createdBy?: string | null;
};

async function resolveEffectiveUnitPrice(
  activityOffering: { price: Prisma.Decimal | null; useDefaultPrice: boolean },
  offeringType: { defaultPrice: Prisma.Decimal | null },
  floralSlot: { priceOverride: Prisma.Decimal | null } | null,
  inputUnitPrice: number | null | undefined
): Promise<number | null> {
  if (inputUnitPrice !== undefined && inputUnitPrice !== null) return inputUnitPrice;
  if (floralSlot?.priceOverride != null) return Number(floralSlot.priceOverride);
  if (!activityOffering.useDefaultPrice && activityOffering.price != null) {
    return Number(activityOffering.price);
  }
  if (offeringType.defaultPrice != null) return Number(offeringType.defaultPrice);
  return null;
}

export async function createOfferingClaim(
  input: CreateOfferingClaimInput,
  operatorName?: string | null
): Promise<OfferingClaimResult<{ id: string }>> {
  const activityOffering = await prisma.activityOffering.findUnique({
    where: { id: input.activityOfferingId },
    include: { offeringType: true, templeEvent: true },
  });
  if (!activityOffering) return { ok: false, status: 404, error: "找不到這個活動供品設定" };

  const sponsor = await prisma.member.findUnique({
    where: { id: input.sponsorMemberId },
    include: { household: true },
  });
  if (!sponsor || sponsor.deletedAt || sponsor.household.deletedAt) {
    return { ok: false, status: 404, error: "找不到這位信眾，請先從信眾中心搜尋或新增信眾資料" };
  }

  const offeringType = activityOffering.offeringType;
  const behaviorKind = offeringType.behaviorKind;

  // 需求「十、十一」：花果供品必須指定農曆日期名額，且同一天只能一位認捐人。
  let floralSlot = null as Awaited<ReturnType<typeof prisma.floralOfferingSlot.findUnique>> | null;
  if (behaviorKind === "FLORAL") {
    if (!input.floralSlotId) {
      return { ok: false, status: 400, error: "花果供品請選擇認捐的農曆日期" };
    }
    floralSlot = await prisma.floralOfferingSlot.findUnique({ where: { id: input.floralSlotId } });
    if (!floralSlot || floralSlot.activityOfferingId !== input.activityOfferingId) {
      return { ok: false, status: 404, error: "找不到這個花果供品日期名額" };
    }
    if (!floralSlot.isActive) {
      return { ok: false, status: 400, error: "這個農曆日期目前已停用，不能認捐" };
    }
    const existingSlotClaim = await prisma.offeringClaim.count({
      where: { floralSlotId: floralSlot.id, status: "ACTIVE", deletedAt: null },
    });
    if (existingSlotClaim > 0) {
      return { ok: false, status: 409, error: "這個農曆日期已經有人認捐" };
    }
  } else {
    // 需求「一、四、五」：非重複認捐限制（大福壽龜/小福壽龜等）。
    const existingSameType = await prisma.offeringClaim.count({
      where: {
        activityOfferingId: input.activityOfferingId,
        sponsorMemberId: input.sponsorMemberId,
        status: "ACTIVE",
        deletedAt: null,
      },
    });
    const dupCheck = checkDuplicateClaimConflict(
      offeringType.allowDuplicateClaim,
      offeringType.name,
      existingSameType > 0
    );
    if (!dupCheck.allowed) {
      return { ok: false, status: 409, error: dupCheck.reason ?? "不能重複認捐" };
    }
  }

  // 需求「六」：壽龜跨供品種類互斥（大福壽龜／小福壽龜擇一，合併計算）。
  // 這是三玄宮固定宮務規則，一律強制套用，不受任何活動設定開關影響——
  // 見 checkTurtleExclusiveConflict() 開頭的說明（2026-07-16 驗收修正）。
  // 優先依 sponsorMemberId 判斷是否為同一人（認捐一律要求真正的 Member
  // 主資料，見上方 sponsor 解析，因此這裡不需要另外用姓名/電話輔助比對）。
  if (behaviorKind === "TURTLE") {
    const existingTurtleClaims = await prisma.offeringClaim.findMany({
      where: {
        activityId: activityOffering.templeEventId,
        sponsorMemberId: input.sponsorMemberId,
        status: "ACTIVE",
        deletedAt: null,
        offeringTypeId: { not: offeringType.id },
      },
      include: { offeringType: true },
    });
    const hasOtherTurtle = existingTurtleClaims.some((c) => c.offeringType.behaviorKind === "TURTLE");
    const turtleCheck = checkTurtleExclusiveConflict(behaviorKind, hasOtherTurtle);
    if (!turtleCheck.allowed) {
      return { ok: false, status: 409, error: turtleCheck.reason ?? "不能重複登錄福壽龜" };
    }
  }

  // 需求「二」：名額檢查（花果供品的名額本來就受限於 24 個 slot，已經在上面擋過，這裡只檢查非花果供品）。
  if (behaviorKind !== "FLORAL" && activityOffering.hasLimitedQuantity) {
    const activeClaims = await prisma.offeringClaim.findMany({
      where: { activityOfferingId: input.activityOfferingId, status: "ACTIVE", deletedAt: null },
      select: { quantity: true },
    });
    const quota = computeOfferingQuota(
      activityOffering.quantity,
      activeClaims.map((c) => c.quantity),
      activityOffering.claimMode
    );
    const incomingQuantity = input.quantity ?? 1;
    if (quota.remaining < (activityOffering.claimMode === "GROUPED" ? 1 : incomingQuantity)) {
      return { ok: false, status: 409, error: "名額已滿，無法再新增認捐" };
    }
  }

  const quantity = input.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, status: 400, error: "數量請輸入正整數" };
  }

  const unitPrice = await resolveEffectiveUnitPrice(activityOffering, offeringType, floralSlot, input.unitPrice);
  const amountDue = computeAmountDue(quantity, unitPrice, activityOffering.isChargeable);

  const created = await prisma.$transaction(async (tx) => {
    const claim = await tx.offeringClaim.create({
      data: {
        activityId: activityOffering.templeEventId,
        activityOfferingId: input.activityOfferingId,
        offeringTypeId: offeringType.id,
        floralSlotId: floralSlot?.id ?? null,
        year: activityOffering.templeEvent.year,
        sponsorMemberId: sponsor.id,
        sponsorHouseholdId: sponsor.householdId,
        sponsorNameSnapshot: sponsor.name,
        phoneSnapshot: sponsor.household.phone ?? null,
        quantity,
        unitPrice,
        amountDue,
        amountPaid: 0,
        amountUnpaid: amountDue,
        paymentStatus: amountDue <= 0 ? "PAID" : "UNPAID",
        expectedPaymentDate: input.expectedPaymentDate ?? null,
        note: input.note?.trim() || null,
        createdBy: input.createdBy?.trim() || null,
      },
    });
    await recordVersion(
      { entityType: "OfferingClaim", entityId: claim.id, action: "CREATE", afterData: claim, operatorName },
      tx
    );

    // 名額滿了自動標記活動供品狀態為「額滿」（需求「二」狀態欄位），只在目前是
    // 「開放」時才自動轉換，管理者手動設定的「停止/結案」不會被這裡覆蓋回去。
    if (behaviorKind !== "FLORAL" && activityOffering.hasLimitedQuantity && activityOffering.status === "OPEN") {
      const afterClaims = await tx.offeringClaim.findMany({
        where: { activityOfferingId: input.activityOfferingId, status: "ACTIVE", deletedAt: null },
        select: { quantity: true },
      });
      const quotaAfter = computeOfferingQuota(
        activityOffering.quantity,
        afterClaims.map((c) => c.quantity),
        activityOffering.claimMode
      );
      if (quotaAfter.remaining <= 0) {
        await tx.activityOffering.update({ where: { id: input.activityOfferingId }, data: { status: "FULL" } });
      }
    }

    return claim;
  });

  return { ok: true, data: { id: created.id } };
}

// ============================================================
// 二、查詢
// ============================================================

export async function getOfferingClaim(id: string) {
  return prisma.offeringClaim.findUnique({
    where: { id },
    include: { offeringType: true, floralSlot: true, sponsorMember: true, sponsorHousehold: true, payments: true },
  });
}

export type OfferingClaimListFilters = {
  activityId?: string;
  activityOfferingId?: string;
  offeringTypeId?: string;
  status?: OfferingClaimStatus;
  paymentStatus?: OfferingPaymentStatusValue;
  sponsorHouseholdId?: string;
  sponsorMemberId?: string;
  onlyUnpaid?: boolean;
  onlyCrossYearUnpaid?: boolean;
  currentYear?: number;
};

export async function listOfferingClaims(filters: OfferingClaimListFilters) {
  const where: Prisma.OfferingClaimWhereInput = { deletedAt: null };
  if (filters.activityId) where.activityId = filters.activityId;
  if (filters.activityOfferingId) where.activityOfferingId = filters.activityOfferingId;
  if (filters.offeringTypeId) where.offeringTypeId = filters.offeringTypeId;
  if (filters.status) where.status = filters.status;
  if (filters.paymentStatus) where.paymentStatus = filters.paymentStatus;
  if (filters.sponsorHouseholdId) where.sponsorHouseholdId = filters.sponsorHouseholdId;
  if (filters.sponsorMemberId) where.sponsorMemberId = filters.sponsorMemberId;
  if (filters.onlyUnpaid) where.paymentStatus = { in: ["UNPAID", "PARTIAL"] };

  const claims = await prisma.offeringClaim.findMany({
    where,
    include: { offeringType: true, floralSlot: true, sponsorMember: true, sponsorHousehold: true },
    orderBy: [{ createdAt: "asc" }],
  });

  if (!filters.onlyCrossYearUnpaid) return claims;
  const currentYear = filters.currentYear ?? new Date().getFullYear() - 1911;
  return claims.filter((c) => isCrossYearUnpaid(c.year, currentYear, c.paymentStatus as OfferingPaymentStatusValue));
}

/** 需求「十二」：全年花果供品名單，含尚未認捐的日期（claim 為 null）。 */
export async function listFloralOfferingRoster(activityOfferingId: string) {
  const [slots, claims] = await Promise.all([
    prisma.floralOfferingSlot.findMany({ where: { activityOfferingId }, orderBy: { sortOrder: "asc" } }),
    prisma.offeringClaim.findMany({
      where: { activityOfferingId, status: "ACTIVE", deletedAt: null },
      include: { sponsorMember: true, payments: true },
    }),
  ]);
  const claimBySlot = new Map(claims.filter((c) => c.floralSlotId).map((c) => [c.floralSlotId as string, c]));
  return slots.map((slot) => ({ slot, claim: claimBySlot.get(slot.id) ?? null }));
}

/** 需求「十八」：從信眾資料頁查看某位信眾歷年供品認捐紀錄。歷史價格不受後續調整影響（直接讀存在 claim 上的 unitPrice/amountDue 快照）。 */
export async function getMemberOfferingHistory(memberId: string) {
  return prisma.offeringClaim.findMany({
    where: { sponsorMemberId: memberId, deletedAt: null },
    include: { offeringType: true, floralSlot: true, activity: true, payments: true },
    orderBy: [{ year: "desc" }, { createdAt: "desc" }],
  });
}

// ============================================================
// 三、修改（需求「二十一」：金額修改/免收都需要留下操作前後內容）
// ============================================================

export type UpdateOfferingClaimInput = {
  unitPrice?: number | null;
  quantity?: number;
  isWaived?: boolean;
  expectedPaymentDate?: Date | null;
  collectionNote?: string | null;
  note?: string | null;
};

export async function updateOfferingClaim(
  id: string,
  input: UpdateOfferingClaimInput,
  operatorName?: string | null,
  changeReason?: string | null
): Promise<OfferingClaimResult<{ id: string }>> {
  const existing = await prisma.offeringClaim.findUnique({
    where: { id },
    include: { activityOffering: true, payments: true },
  });
  if (!existing || existing.deletedAt) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (existing.status !== "ACTIVE") {
    return { ok: false, status: 400, error: "這筆認捐目前不是有效狀態，無法修改" };
  }
  if (input.unitPrice !== undefined && !existing.activityOffering.allowPriceOverride) {
    return { ok: false, status: 403, error: "這個供品不允許單筆修改價格" };
  }

  const quantity = input.quantity ?? existing.quantity;
  const unitPrice = input.unitPrice !== undefined ? input.unitPrice : existing.unitPrice ? Number(existing.unitPrice) : null;
  const isWaived = input.isWaived ?? existing.paymentStatus === "WAIVED";
  const amountDue = computeAmountDue(quantity, unitPrice, existing.activityOffering.isChargeable && !isWaived);
  const paidTotal = existing.payments
    .filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN")
    .reduce((s, p) => s + Number(p.amount), 0);
  const refundedTotal = existing.payments
    .filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT")
    .reduce((s, p) => s + Number(p.amount), 0);
  const amountPaid = round2(Math.max(0, paidTotal - refundedTotal));
  const paymentStatus = derivePaymentStatus(amountDue, amountPaid, isWaived);

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.offeringClaim.update({
      where: { id },
      data: {
        quantity,
        unitPrice,
        amountDue,
        amountPaid,
        amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
        paymentStatus,
        expectedPaymentDate: input.expectedPaymentDate !== undefined ? input.expectedPaymentDate : existing.expectedPaymentDate,
        collectionNote: input.collectionNote !== undefined ? input.collectionNote?.trim() || null : existing.collectionNote,
        note: input.note !== undefined ? input.note?.trim() || null : existing.note,
      },
    });
    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: u,
        operatorName,
        changeNote: changeReason ?? null,
      },
      tx
    );
    return u;
  });

  return { ok: true, data: { id: updated.id } };
}

// ============================================================
// 四、收款（需求「十三」：每次收款獨立保存，不得只存累計金額）
// ============================================================

export type RecordPaymentInput = {
  amount: number;
  paidOn: Date;
  method?: string | null;
  collectedByName?: string | null;
  receiptNumber?: string | null;
  note?: string | null;
};

export async function recordOfferingPayment(
  claimId: string,
  input: RecordPaymentInput,
  operatorName?: string | null
): Promise<OfferingClaimResult<{ paymentId: string }>> {
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 400, error: "請輸入正確的收款金額" };
  }
  const claim = await prisma.offeringClaim.findUnique({ where: { id: claimId }, include: { payments: true } });
  if (!claim || claim.deletedAt) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (claim.status !== "ACTIVE") return { ok: false, status: 400, error: "這筆認捐目前不是有效狀態，無法收款" };

  const result = await prisma.$transaction(async (tx) => {
    const payment = await tx.offeringPayment.create({
      data: {
        offeringClaimId: claimId,
        kind: "PAYMENT",
        amount: input.amount,
        paidOn: input.paidOn,
        method: input.method ?? null,
        collectedByName: input.collectedByName?.trim() || null,
        receiptNumber: input.receiptNumber?.trim() || null,
        note: input.note?.trim() || null,
      },
    });

    const allPayments = [...claim.payments, payment];
    const paidTotal = allPayments
      .filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN")
      .reduce((s, p) => s + Number(p.amount), 0);
    const refundedTotal = allPayments
      .filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT")
      .reduce((s, p) => s + Number(p.amount), 0);
    const amountPaid = round2(Math.max(0, paidTotal - refundedTotal));
    const amountDue = Number(claim.amountDue);
    const paymentStatus = derivePaymentStatus(amountDue, amountPaid, claim.paymentStatus === "WAIVED");

    const updated = await tx.offeringClaim.update({
      where: { id: claimId },
      data: {
        amountPaid,
        amountUnpaid: round2(Math.max(0, amountDue - amountPaid)),
        paymentStatus,
        receiptStatus: input.receiptNumber ? "ISSUED" : claim.receiptStatus,
      },
    });

    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: claimId,
        action: "UPDATE",
        beforeData: claim,
        afterData: updated,
        operatorName,
        changeNote: `收款 ${input.amount} 元`,
      },
      tx
    );

    return payment;
  });

  return { ok: true, data: { paymentId: result.id } };
}

/** 需求「十四」：補印收據，不得產生新應收款——只遞增 reprintCount，不動任何金額欄位。 */
export async function reprintOfferingReceipt(
  paymentId: string
): Promise<OfferingClaimResult<{ paymentId: string }>> {
  const existing = await prisma.offeringPayment.findUnique({ where: { id: paymentId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆收款紀錄" };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.offeringPayment.update({
      where: { id: paymentId },
      data: { reprintCount: { increment: 1 }, lastReprintAt: new Date() },
    });
    await tx.offeringClaim.update({
      where: { id: existing.offeringClaimId },
      data: { receiptStatus: "REPRINTED" },
    });
    return u;
  });
  return { ok: true, data: { paymentId: updated.id } };
}

// ============================================================
// 五、取消與退款（需求「二十」）
// ============================================================

/**
 * 取消認捐。尚未收款（amountPaid<=0）：直接取消，釋出名額（需求「十八」）。
 * 已收款（amountPaid>0）：不得直接取消，改成「退款/轉款處理中」狀態，
 * 必須呼叫下方 refundOfferingClaim() 完成退款/轉款流程後才會真正變成
 * REFUNDED（需求「二十」）。
 */
export async function cancelOfferingClaim(
  id: string,
  operatorName?: string | null,
  reason?: string | null
): Promise<OfferingClaimResult<{ id: string; status: OfferingClaimStatus }>> {
  const existing = await prisma.offeringClaim.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (existing.status !== "ACTIVE") return { ok: false, status: 400, error: "這筆認捐目前不是有效狀態" };

  const hasBeenPaid = Number(existing.amountPaid) > 0;
  const nextStatus: OfferingClaimStatus = hasBeenPaid ? "REFUND_PENDING" : "CANCELLED";

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.offeringClaim.update({ where: { id }, data: { status: nextStatus } });
    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: u,
        operatorName,
        changeNote: hasBeenPaid ? `取消（已收款，待退款/轉款）：${reason ?? ""}` : `取消：${reason ?? ""}`,
      },
      tx
    );

    // 尚未收款的取消，才能立即釋出名額；已收款的要等退款完成（見 refundOfferingClaim）。
    if (!hasBeenPaid && existing.activityOfferingId) {
      const offering = await tx.activityOffering.findUnique({ where: { id: existing.activityOfferingId } });
      if (offering && offering.status === "FULL") {
        await tx.activityOffering.update({ where: { id: offering.id }, data: { status: "OPEN" } });
      }
    }

    return u;
  });

  return { ok: true, data: { id: updated.id, status: updated.status } };
}

export async function restoreOfferingClaim(
  id: string,
  operatorName?: string | null
): Promise<OfferingClaimResult<{ id: string }>> {
  const existing = await prisma.offeringClaim.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (existing.status === "ACTIVE") return { ok: false, status: 400, error: "這筆認捐目前就是有效狀態" };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.offeringClaim.update({ where: { id }, data: { status: "ACTIVE" } });
    await recordVersion(
      { entityType: "OfferingClaim", entityId: id, action: "RESTORE", beforeData: existing, afterData: u, operatorName },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}

export type RefundOfferingClaimInput = {
  amount: number;
  paidOn: Date;
  kind?: Extract<OfferingPaymentKind, "REFUND" | "TRANSFER_OUT">;
  reason: string;
  operatorName?: string | null;
  relatedClaimId?: string | null;
};

/** 需求「二十」：完成退款/轉款——保存退款金額、日期、經手人及原因，並把認捐狀態轉為 REFUNDED。 */
export async function refundOfferingClaim(
  id: string,
  input: RefundOfferingClaimInput
): Promise<OfferingClaimResult<{ id: string }>> {
  if (!input.reason?.trim()) return { ok: false, status: 400, error: "退款/轉款請填寫原因" };
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, status: 400, error: "請輸入正確的退款金額" };
  }
  const existing = await prisma.offeringClaim.findUnique({ where: { id }, include: { payments: true } });
  if (!existing || existing.deletedAt) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (existing.status !== "REFUND_PENDING") {
    return { ok: false, status: 400, error: "這筆認捐目前不是「待退款/轉款」狀態" };
  }

  const kind = input.kind ?? "REFUND";

  const updated = await prisma.$transaction(async (tx) => {
    await tx.offeringPayment.create({
      data: {
        offeringClaimId: id,
        kind,
        amount: input.amount,
        paidOn: input.paidOn,
        collectedByName: input.operatorName?.trim() || null,
        reason: input.reason.trim(),
        relatedClaimId: input.relatedClaimId ?? null,
      },
    });

    const allPayments = [...existing.payments, { kind, amount: input.amount } as { kind: OfferingPaymentKind; amount: Prisma.Decimal | number }];
    const paidTotal = allPayments
      .filter((p) => p.kind === "PAYMENT" || p.kind === "TRANSFER_IN")
      .reduce((s, p) => s + Number(p.amount), 0);
    const refundedTotal = allPayments
      .filter((p) => p.kind === "REFUND" || p.kind === "TRANSFER_OUT")
      .reduce((s, p) => s + Number(p.amount), 0);
    const amountPaid = round2(Math.max(0, paidTotal - refundedTotal));

    const u = await tx.offeringClaim.update({
      where: { id },
      data: {
        status: "REFUNDED",
        amountPaid,
        amountUnpaid: round2(Math.max(0, Number(existing.amountDue) - amountPaid)),
        refundedAmount: input.amount,
        refundReason: input.reason.trim(),
        refundedAt: new Date(),
        refundedByName: input.operatorName?.trim() || null,
      },
    });

    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: u,
        operatorName: input.operatorName,
        changeNote: `${kind === "REFUND" ? "退款" : "轉款"} ${input.amount} 元：${input.reason}`,
      },
      tx
    );

    // 已收款取消完成退款/轉款流程後，才真正釋出名額。
    const offering = await tx.activityOffering.findUnique({ where: { id: existing.activityOfferingId } });
    if (offering && offering.status === "FULL") {
      await tx.activityOffering.update({ where: { id: offering.id }, data: { status: "OPEN" } });
    }

    return u;
  });

  return { ok: true, data: { id: updated.id } };
}

// ============================================================
// 六、刪除保護（同 V9.1 AdditionalPrintItem 兩層機制）
// ============================================================

export async function moveOfferingClaimToRecycleBin(
  id: string,
  operatorName?: string | null
): Promise<OfferingClaimResult<{ id: string }>> {
  const existing = await prisma.offeringClaim.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆認捐資料" };
  if (existing.status !== "CANCELLED" && existing.status !== "REFUNDED") {
    return { ok: false, status: 400, error: "只有已取消或已完成退款/轉款的認捐才能移入回收區" };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.offeringClaim.update({
      where: { id },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });
    await recordVersion(
      {
        entityType: "OfferingClaim",
        entityId: id,
        action: "DELETE",
        beforeData: existing,
        afterData: updated,
        operatorName,
        changeNote: "移入回收區（待永久刪除）",
      },
      tx
    );
  });
  return { ok: true, data: { id } };
}

// ============================================================
// 七、首頁提醒與跨年度未收款彙總（需求「七、十六」）
// ============================================================

export type OfferingHomeSummary = {
  floralTotalSlots: number;
  floralClaimedCount: number;
  floralUnclaimedCount: number;
  floralUnpaidCount: number;
  largeTurtleClaimed: boolean;
  smallTurtleRemaining: number | null;
  noodleTowerRemaining: number | null;
  loosePeachRemaining: number | null;
  crossYearUnpaidCount: number;
  crossYearUnpaidAmount: number;
};

/**
 * 需求「十六」：首頁供品認捐提醒卡的統計資料。這裡固定針對「目前年度」＋
 * 這幾種 behaviorKind 統計——因為首頁提醒卡本來就是給行政人員一眼看出
 * 「還有哪些事要做」，只顯示既有 5 種預設供品行為分類的彙總，其他自訂供品
 * （例如平安米/鮮花）建議透過「未認捐清單」「未收款清單」查看完整清單。
 */
export async function getOfferingHomeSummary(currentYear: number): Promise<OfferingHomeSummary> {
  const [floralOfferings, turtleClaims, noodleOffering, loosePeachOffering, allClaims] = await Promise.all([
    prisma.activityOffering.findMany({
      where: { templeEvent: { year: currentYear }, offeringType: { behaviorKind: "FLORAL" } },
      include: { floralSlots: true },
    }),
    prisma.offeringClaim.findMany({
      where: { year: currentYear, status: "ACTIVE", deletedAt: null, offeringType: { behaviorKind: "TURTLE" } },
      include: { offeringType: true },
    }),
    prisma.activityOffering.findMany({
      where: { templeEvent: { year: currentYear }, offeringType: { behaviorKind: "NOODLE_TOWER" } },
    }),
    prisma.activityOffering.findMany({
      where: { templeEvent: { year: currentYear }, offeringType: { behaviorKind: "LOOSE_PEACH" } },
    }),
    prisma.offeringClaim.findMany({ where: { status: "ACTIVE", deletedAt: null } }),
  ]);

  const floralTotalSlots = floralOfferings.reduce((s, o) => s + o.floralSlots.length, 0);
  const floralClaims = await prisma.offeringClaim.findMany({
    where: {
      year: currentYear,
      status: "ACTIVE",
      deletedAt: null,
      offeringType: { behaviorKind: "FLORAL" },
    },
  });
  const floralClaimedCount = floralClaims.length;
  const floralUnpaidCount = floralClaims.filter((c) => c.paymentStatus === "UNPAID" || c.paymentStatus === "PARTIAL").length;

  const largeTurtleClaimed = turtleClaims.some((c) => c.offeringType.defaultQuantity === 1);

  let smallTurtleRemaining: number | null = null;
  const smallTurtleOffering = await prisma.activityOffering.findFirst({
    where: { templeEvent: { year: currentYear }, offeringType: { name: "小福壽龜" } },
  });
  if (smallTurtleOffering) {
    const claimed = turtleClaims.filter((c) => c.offeringTypeId === smallTurtleOffering.offeringTypeId).length;
    smallTurtleRemaining = Math.max(0, smallTurtleOffering.quantity - claimed);
  }

  let noodleTowerRemaining: number | null = null;
  if (noodleOffering.length > 0) {
    const claims = await prisma.offeringClaim.count({
      where: { activityOfferingId: { in: noodleOffering.map((o) => o.id) }, status: "ACTIVE", deletedAt: null },
    });
    const totalQuantity = noodleOffering.reduce((s, o) => s + o.quantity, 0);
    noodleTowerRemaining = Math.max(0, totalQuantity - claims);
  }

  let loosePeachRemaining: number | null = null;
  if (loosePeachOffering.length > 0) {
    const claims = await prisma.offeringClaim.findMany({
      where: { activityOfferingId: { in: loosePeachOffering.map((o) => o.id) }, status: "ACTIVE", deletedAt: null },
      select: { quantity: true, activityOfferingId: true },
    });
    loosePeachRemaining = loosePeachOffering.reduce((sum, o) => {
      const claimsForOffering = claims.filter((c) => c.activityOfferingId === o.id).map((c) => c.quantity);
      const quota = computeOfferingQuota(o.quantity, claimsForOffering, o.claimMode);
      return sum + quota.remaining;
    }, 0);
  }

  const crossYearUnpaid = allClaims.filter((c) =>
    isCrossYearUnpaid(c.year, currentYear, c.paymentStatus as OfferingPaymentStatusValue)
  );

  return {
    floralTotalSlots,
    floralClaimedCount,
    floralUnclaimedCount: Math.max(0, floralTotalSlots - floralClaimedCount),
    floralUnpaidCount,
    largeTurtleClaimed,
    smallTurtleRemaining,
    noodleTowerRemaining,
    loosePeachRemaining,
    crossYearUnpaidCount: crossYearUnpaid.length,
    crossYearUnpaidAmount: round2(crossYearUnpaid.reduce((s, c) => s + Number(c.amountUnpaid), 0)),
  };
}

/**
 * 「財務中心」整合的預留橋接函式（見 schema.prisma V10.1 段落開頭的誠實
 * 說明）：財務中心目前還沒有畫面/API，這支函式先把供品收款資料整理成
 * FinanceRecord 需要的形狀（category/amount/occurredOn/description），
 * 之後財務中心真正開發、登入機制做出來後，可以直接拿這支函式的回傳值
 * 建立 FinanceRecord 草稿，不需要重新從供品認捐資料反查一次。
 */
export async function getOfferingIncomeSummaryForFinance(dateFrom: Date, dateTo: Date) {
  const payments = await prisma.offeringPayment.findMany({
    where: { paidOn: { gte: dateFrom, lte: dateTo }, kind: { in: ["PAYMENT", "TRANSFER_IN"] } },
    include: { offeringClaim: { include: { offeringType: true } } },
    orderBy: { paidOn: "asc" },
  });
  return payments.map((p) => ({
    category: `供品認捐－${p.offeringClaim.offeringType.name}`,
    amount: Number(p.amount),
    occurredOn: p.paidOn,
    description: `${p.offeringClaim.sponsorNameSnapshot}／收據 ${p.receiptNumber ?? "（未開立）"}`,
  }));
}
