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
  computeRiceAmountDue,
  computeRiceQuota,
  checkRiceOverage,
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
  note: string | null;
  registeredKg: number;
  remainingKg: number;
  isOverbooked: boolean;
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
    select: { id: true, year: true, riceTotalKg: true, riceUnitPrice: true, riceOpen: true, riceNote: true },
  });
  if (!event) return null;

  const agg = await prisma.ritualRegistrationItem.aggregate({
    where: validRiceItemWhere(event.year),
    _sum: { quantity: true, amountDue: true, amountPaid: true, amountUnpaid: true },
  });

  const registeredKg = agg._sum.quantity ?? 0;
  const totalKg = toNum(event.riceTotalKg);
  const quota = computeRiceQuota(totalKg, registeredKg);

  return {
    year: event.year,
    totalKg,
    unitPrice: toNum(event.riceUnitPrice),
    open: event.riceOpen,
    note: event.riceNote,
    registeredKg: quota.registeredKg,
    remainingKg: quota.remainingKg,
    isOverbooked: quota.isOverbooked,
    totalAmountDue: Number(agg._sum.amountDue ?? 0),
    totalAmountPaid: Number(agg._sum.amountPaid ?? 0),
    totalAmountUnpaid: Number(agg._sum.amountUnpaid ?? 0),
  };
}

export type UpdateRiceConfigInput = {
  totalKg?: number | null;
  unitPrice?: number | null;
  open?: boolean;
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
        select: { riceTotalKg: true, riceUnitPrice: true, riceOpen: true, year: true },
      });
      if (!event) return { ok: false as const, status: 404, error: "找不到年度活動" };
      const unitPrice = toNum(event.riceUnitPrice);
      if (!event.riceOpen || event.riceTotalKg === null || unitPrice === null) {
        return { ok: false as const, status: 400, error: "白米年度配額尚未設定或未開放認購" };
      }

      // 重新彙總「目前有效認購斤數」，剩餘＝總 − 有效（不快取增減）。
      const agg = await tx.ritualRegistrationItem.aggregate({
        where: validRiceItemWhere(event.year),
        _sum: { quantity: true },
      });
      const registeredKg = agg._sum.quantity ?? 0;
      const remainingKg = computeRiceQuota(toNum(event.riceTotalKg), registeredKg).remainingKg;

      const decision = checkRiceOverage(actor.role, kg, remainingKg, input.overageReason);
      if (!decision.ok) return { ok: false as const, status: 403, error: decision.reason };
      const isOverage = decision.overage === true;

      const amountDue = computeRiceAmountDue(kg, unitPrice) ?? 0;

      const item = await tx.ritualRegistrationItem.create({
        data: {
          ritualRecordId: record.id,
          registrationItemTypeId: type.id,
          memberId: input.memberId ?? null,
          quantity: Math.round(kg),
          amountDue: new Prisma.Decimal(amountDue),
          amountUnpaid: new Prisma.Decimal(amountDue),
          lockedUnitPrice: new Prisma.Decimal(unitPrice),
          status: "CONFIRMED",
          notes: isOverage ? `超額認購（剩餘 ${remainingKg} 斤）原因：${input.overageReason ?? ""}｜核准：${actor.name}` : null,
        },
      });

      await recordVersion(
        {
          entityType: "RitualRegistrationItem",
          entityId: item.id,
          action: "CREATE",
          afterData: item,
          operatorName: actor.name,
          changeNote: isOverage ? "白米超額認購（已記錄操作人/時間/原因）" : "白米認購",
        },
        tx
      );

      return { ok: true as const, itemId: item.id, amountDue, overage: isOverage };
  };
  // 有外部 tx → 直接用該 tx（納入呼叫端交易）；否則自開一個 transaction（原行為）。
  return db ? run(db) : prisma.$transaction(run);
}
