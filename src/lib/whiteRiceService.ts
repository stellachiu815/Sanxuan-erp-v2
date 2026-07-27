/**
 * V14.4 白米年度配額「資料庫服務」層（指令四／五）。
 *
 * 純規則在 src/lib/whiteRice.ts；這裡負責讀寫既有資料表（TempleEvent 年度設定、
 * RitualRegistrationItem contentKind=RICE 報名），不另建白米專屬表、不另建收款系統。
 * 剩餘斤數一律由「有效正式報名」即時彙總（transaction），不做快取加減。
 */

import { Prisma } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import {
  computeRiceQuota,
  computeRiceItemData,
  evaluateRiceQuota,
  type Role,
} from "@/lib/whiteRice";

function toNum(d: Prisma.Decimal | null | undefined): number | null {
  return d === null || d === undefined ? null : Number(d);
}

/** 有效正式白米報名的查詢條件：非草稿、非取消、未刪除的 RICE 報名項目。 */
function validRiceItemWhere(year: number): Prisma.RitualRegistrationItemWhereInput {
  return {
    deletedAt: null,
    status: "CONFIRMED",
    registrationItemType: { contentKind: "RICE" },
    ritualRecord: { activityType: "UNIVERSAL_SALVATION", year },
  };
}

export type RiceQuotaSummary = {
  year: number;
  totalKg: number | null;
  unitPrice: number | null;
  open: boolean;
  allowOverbook: boolean;
  note: string | null;
  registeredKg: number;
  remainingKg: number;
  isOverbooked: boolean;
  count: number;
  totalAmountDue: number;
  totalAmountPaid: number;
  totalAmountUnpaid: number;
};

/**
 * 年度白米配額即時彙總：讀 TempleEvent 設定 + 由有效正式報名重新彙總斤數與金額。
 * 剩餘斤數＝總斤數 − 有效認購斤數（指令四），不快取增減。
 */
export async function getRiceQuotaSummary(templeEventId: string): Promise<RiceQuotaSummary | null> {
  const event = await prisma.templeEvent.findUnique({
    where: { id: templeEventId },
    select: { id: true, year: true, riceTotalKg: true, riceUnitPrice: true, riceOpen: true, riceNote: true, riceAllowOverbook: true },
  });
  if (!event) return null;

  const agg = await prisma.ritualRegistrationItem.aggregate({
    where: validRiceItemWhere(event.year),
    _sum: { quantity: true, amountDue: true, amountPaid: true, amountUnpaid: true },
    _count: true,
  });

  const registeredKg = agg._sum.quantity ?? 0;
  const totalKg = toNum(event.riceTotalKg);
  const quota = computeRiceQuota(totalKg, registeredKg);

  return {
    year: event.year,
    totalKg,
    unitPrice: toNum(event.riceUnitPrice),
    open: event.riceOpen,
    allowOverbook: event.riceAllowOverbook,
    note: event.riceNote,
    registeredKg: quota.registeredKg,
    remainingKg: quota.remainingKg,
    isOverbooked: quota.isOverbooked,
    count: agg._count ?? 0,
    totalAmountDue: Number(agg._sum.amountDue ?? 0),
    totalAmountPaid: Number(agg._sum.amountPaid ?? 0),
    totalAmountUnpaid: Number(agg._sum.amountUnpaid ?? 0),
  };
}

export type UpdateRiceConfigInput = {
  totalKg?: number | null;
  unitPrice?: number | null;
  open?: boolean;
  allowOverbook?: boolean;
  note?: string | null;
};

/**
 * 設定/修改年度白米配額（總斤數／每斤金額／是否開放／備註）。每年可不同，不寫死。
 * 修改單價**不回頭改動**既有報名（既有報名的 lockedUnitPrice 是建立當下快照）。
 */
export async function updateRiceConfig(
  templeEventId: string,
  input: UpdateRiceConfigInput,
  operatorName?: string | null
): Promise<{ ok: true; data: RiceQuotaSummary } | { ok: false; status: number; error: string }> {
  const existing = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!existing) return { ok: false, status: 404, error: "找不到這個活動年度" };

  const data: Prisma.TempleEventUpdateInput = {};
  if ("totalKg" in input) {
    if (input.totalKg !== null && (!Number.isFinite(input.totalKg) || (input.totalKg as number) < 0)) {
      return { ok: false, status: 400, error: "白米總斤數必須是 0 以上的數字，或清空" };
    }
    data.riceTotalKg = input.totalKg;
  }
  if ("unitPrice" in input) {
    if (input.unitPrice !== null && (!Number.isFinite(input.unitPrice) || (input.unitPrice as number) < 0)) {
      return { ok: false, status: 400, error: "每斤金額必須是 0 以上的數字，或清空" };
    }
    data.riceUnitPrice = input.unitPrice;
  }
  if ("open" in input) data.riceOpen = Boolean(input.open);
  if ("allowOverbook" in input) data.riceAllowOverbook = Boolean(input.allowOverbook);
  if ("note" in input) data.riceNote = input.note ?? null;

  const after = await prisma.templeEvent.update({ where: { id: templeEventId }, data });
  await recordVersion({
    entityType: "TempleEvent",
    entityId: templeEventId,
    action: "UPDATE",
    beforeData: existing,
    afterData: after,
    operatorName,
    changeNote: "白米年度配額設定",
  });

  const summary = await getRiceQuotaSummary(templeEventId);
  return { ok: true, data: summary! };
}

export type RegisterRiceInput = {
  ritualRecordId: string;
  memberId?: string | null;
  kg: number;
  /** 超額時（僅 ADMIN／SUPER_ADMIN 可）必填。 */
  overageReason?: string | null;
};

/**
 * 正式建立一筆白米認購（RitualRegistrationItem, contentKind=RICE）。
 * - 鎖定 lockedUnitPrice＝年度每斤金額；amountDue＝kg × lockedUnitPrice（指令五、驗收 13）。
 * - 剩餘斤數不足時：STAFF／READONLY 擋；ADMIN／SUPER_ADMIN 需填原因才可超額，並記錄
 *   操作人／時間／原因（指令五、驗收 14）。不可默默變負數。
 * - 收款、分次、未收、活動帳本沿用既有 RitualRegistrationItem 架構（不另建）。
 * 全程在單一 transaction：先鎖定重新彙總剩餘斤數，再建立，避免併發超額。
 */
export async function registerRice(
  input: RegisterRiceInput,
  actor: { role: Role; userId: string; name: string },
  db?: DbClient
): Promise<{ ok: true; itemId: string; amountDue: number; overage: boolean } | { ok: false; status: number; error: string }> {
  const kg = Number(input.kg);
  if (!Number.isFinite(kg) || kg <= 0) return { ok: false, status: 400, error: "認購斤數必須大於 0" };

  // 有外部 tx 時一律用它（讀寫同一交易）；否則用全域 prisma（行為不變）。
  const client = db ?? prisma;
  const record = await client.ritualRecord.findUnique({
    where: { id: input.ritualRecordId },
    select: { id: true, year: true, templeEventId: true, activityType: true },
  });
  if (!record || record.activityType !== "UNIVERSAL_SALVATION") {
    return { ok: false, status: 404, error: "找不到對應的普渡登記" };
  }
  if (!record.templeEventId) {
    return { ok: false, status: 400, error: "這筆普渡登記尚未連結年度活動，無法認購白米" };
  }

  const type = await client.registrationItemType.findFirst({
    where: { contentKind: "RICE", activityType: "UNIVERSAL_SALVATION", isActive: true },
    select: { id: true },
  });
  if (!type) return { ok: false, status: 500, error: "白米報名項目設定不存在" };

  const run = async (tx: DbClient) => {
      const event = await tx.templeEvent.findUnique({
        where: { id: record.templeEventId! },
        select: { riceTotalKg: true, riceUnitPrice: true, riceOpen: true, year: true, riceAllowOverbook: true },
      });
      if (!event) return { ok: false as const, status: 404, error: "找不到年度活動" };
      const unitPrice = toNum(event.riceUnitPrice);
      if (!event.riceOpen || event.riceTotalKg === null || unitPrice === null) {
        return { ok: false as const, status: 400, error: "白米年度配額尚未設定或未開放認購" };
      }

      // V16：斤數必須正整數、單價已設定（不無聲四捨五入、不偷用 0）。
      const calc = computeRiceItemData(kg, unitPrice);
      if (!calc.ok) return { ok: false as const, status: 400, error: calc.error };

      // 重新彙總「目前有效認購斤數」，依「允許超量開關」判斷（tx 內，避免併發超量）。
      const agg = await tx.ritualRegistrationItem.aggregate({ where: validRiceItemWhere(event.year), _sum: { quantity: true } });
      const q = evaluateRiceQuota({
        totalKg: toNum(event.riceTotalKg),
        registeredKg: agg._sum.quantity ?? 0,
        deltaKg: calc.data.quantity,
        allowOverbook: event.riceAllowOverbook,
      });
      if (!q.ok) return { ok: false as const, status: 403, error: q.error };

      const item = await tx.ritualRegistrationItem.create({
        data: {
          ritualRecordId: record.id,
          registrationItemTypeId: type.id,
          memberId: input.memberId ?? null,
          quantity: calc.data.quantity,
          amountDue: new Prisma.Decimal(calc.data.amountDue),
          amountPaid: new Prisma.Decimal(0),
          amountUnpaid: new Prisma.Decimal(calc.data.amountUnpaid),
          lockedUnitPrice: new Prisma.Decimal(calc.data.lockedUnitPrice),
          status: "CONFIRMED",
          notes: q.overbook ? `超量認購（超出後剩餘 ${q.remainingAfter} 斤）｜核准：${actor.name}` : null,
        },
      });

      await recordVersion(
        {
          entityType: "RitualRegistrationItem",
          entityId: item.id,
          action: "CREATE",
          afterData: item,
          operatorName: actor.name,
          changeNote: q.overbook ? "白米超量認購（本年度開放超量，已記錄操作人）" : "白米認購",
        },
        tx
      );

      return { ok: true as const, itemId: item.id, amountDue: calc.data.amountDue, overage: q.overbook };
  };
  // 有外部 tx → 直接用該 tx（納入呼叫端交易）；否則自開一個 transaction（原行為）。
  return db ? run(db) : prisma.$transaction(run);
}

/**
 * V16：可重用的年度配額檢查（tx 內）。deltaKg＝本次「新增的有效斤數」。
 * 由各入口（確認報名、Excel 匯入、批次、恢復、加斤數）於同一 transaction 內、寫入前呼叫，
 * 依「允許超量開關」阻擋（關閉時所有角色一律阻擋，回傳詳細數字）。
 */
export async function assertRiceQuota(
  tx: DbClient,
  templeEventId: string,
  deltaKg: number
): Promise<{ ok: true; overbook: boolean } | { ok: false; status: number; error: string }> {
  const event = await tx.templeEvent.findUnique({
    where: { id: templeEventId },
    select: { year: true, riceTotalKg: true, riceAllowOverbook: true },
  });
  if (!event) return { ok: false, status: 404, error: "找不到年度活動" };
  const agg = await tx.ritualRegistrationItem.aggregate({ where: validRiceItemWhere(event.year), _sum: { quantity: true } });
  const q = evaluateRiceQuota({
    totalKg: toNum(event.riceTotalKg),
    registeredKg: agg._sum.quantity ?? 0,
    deltaKg,
    allowOverbook: event.riceAllowOverbook,
  });
  if (!q.ok) return { ok: false, status: 403, error: q.error };
  return { ok: true, overbook: q.overbook };
}

/**
 * V16：修改白米斤數（用該筆已鎖 lockedUnitPrice 重算）。
 * 增量且該筆為 CONFIRMED（占配額）→ tx 內檢查 delta；減量釋放額度。
 * 新應收 < 已收（溢收）→ 阻擋並回傳詳細數字，須先走既有退款/沖銷流程；不動 amountPaid/收款/交易。
 */
export async function updateRiceQuantity(
  itemId: string,
  newKg: number,
  operator: { name: string },
  db?: DbClient
): Promise<{ ok: true; quantity: number; amountDue: number; amountUnpaid: number } | { ok: false; status: number; error: string }> {
  const run = async (tx: DbClient) => {
    const item = await tx.ritualRegistrationItem.findUnique({
      where: { id: itemId },
      include: { registrationItemType: { select: { contentKind: true } }, ritualRecord: { select: { templeEventId: true } } },
    });
    if (!item || item.deletedAt) return { ok: false as const, status: 404, error: "找不到這筆白米報名" };
    if (item.registrationItemType.contentKind !== "RICE") return { ok: false as const, status: 400, error: "這不是白米報名項目" };
    if (item.status === "CANCELLED") return { ok: false as const, status: 400, error: "已取消的白米報名不可修改斤數" };

    const unitPrice = toNum(item.lockedUnitPrice);
    const calc = computeRiceItemData(newKg, unitPrice); // 用該筆已鎖單價、正整數驗證
    if (!calc.ok) return { ok: false as const, status: 400, error: calc.error };

    const oldKg = item.quantity;
    const delta = calc.data.quantity - oldKg;
    // 增量且已占配額（CONFIRMED）→ 檢查 delta；DRAFT 不占配額（確認時才檢查）。
    if (delta > 0 && item.status === "CONFIRMED" && item.ritualRecord.templeEventId) {
      const q = await assertRiceQuota(tx, item.ritualRecord.templeEventId, delta);
      if (!q.ok) return q;
    }

    const amountPaid = Number(item.amountPaid);
    if (calc.data.amountDue < amountPaid) {
      return {
        ok: false as const,
        status: 409,
        error: `修改後新應收（${calc.data.amountDue} 元）低於已收（${amountPaid} 元）——原斤數 ${oldKg} 斤／新斤數 ${calc.data.quantity} 斤／原應收 ${Number(item.amountDue)} 元／新應收 ${calc.data.amountDue} 元／已收 ${amountPaid} 元／溢收 ${Math.round((amountPaid - calc.data.amountDue) * 100) / 100} 元。請先於收款中心辦理退款／沖銷後再調整。`,
      };
    }
    const amountUnpaid = Math.round((calc.data.amountDue - amountPaid) * 100) / 100;
    const after = await tx.ritualRegistrationItem.update({
      where: { id: itemId },
      // 只更新斤數/應收/未收；不動 amountPaid、lockedUnitPrice、收款、交易、收據。
      data: { quantity: calc.data.quantity, amountDue: new Prisma.Decimal(calc.data.amountDue), amountUnpaid: new Prisma.Decimal(amountUnpaid) },
    });
    await recordVersion({ entityType: "RitualRegistrationItem", entityId: itemId, action: "UPDATE", beforeData: item, afterData: after, operatorName: operator.name, changeNote: `修改白米斤數 ${oldKg}→${calc.data.quantity} 斤` }, tx);
    return { ok: true as const, quantity: calc.data.quantity, amountDue: calc.data.amountDue, amountUnpaid };
  };
  return db ? run(db) : prisma.$transaction(run);
}
