import { StoveMasterRoleType, StoveMasterStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V10.1「供品認捐中心」需求「十五、爐主與副爐主」核心邏輯。
 *
 * 爐主／副爐主刻意跟供品認捐（OfferingClaim/OfferingPayment）完全分開——
 * 不屬供品、不收費，不會建立任何應收款/收款資料/收據/財務收入，只是單純
 * 的「登錄最後結果」（不記錄擲筊過程，見需求「十五」）。
 */

export type StoveMasterResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string };

export async function listStoveMasterRegistrations(templeEventId: string) {
  return prisma.stoveMasterRegistration.findMany({
    where: { templeEventId },
    orderBy: [{ roleType: "asc" }, { createdAt: "asc" }],
  });
}

export type CreateStoveMasterInput = {
  roleType: StoveMasterRoleType;
  memberId?: string | null;
  householdId?: string | null;
  manualName?: string | null; // 查無信眾資料時，允許先用手動姓名登錄（爐主/副爐主不涉及金流，風險低於供品認捐，維持既有 PurificationEntry 的彈性）
  phone?: string | null;
  note?: string | null;
};

/**
 * 新增爐主／副爐主登錄。預設：爐主 1 位、副爐主名額可自行設定（需求
 * 「十五」）——這裡不強制檢查名額上限（名額本身沒有存在資料庫的欄位，
 * 由畫面依需要自行決定要不要限制人數，避免把「不寫死」的規則反而寫死）。
 */
export async function createStoveMasterRegistration(
  templeEventId: string,
  input: CreateStoveMasterInput,
  operatorName?: string | null
): Promise<StoveMasterResult<{ id: string }>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: templeEventId } });
  if (!event) return { ok: false, status: 404, error: "找不到這個活動" };

  let nameSnapshot = input.manualName?.trim() || null;
  let phoneSnapshot = input.phone?.trim() || null;
  let memberId = input.memberId ?? null;
  let householdId = input.householdId ?? null;

  if (memberId) {
    const member = await prisma.member.findUnique({ where: { id: memberId }, include: { household: true } });
    if (!member || member.deletedAt) return { ok: false, status: 404, error: "找不到這位信眾" };
    nameSnapshot = member.name;
    phoneSnapshot = member.household.phone ?? null;
    householdId = member.householdId;
  }

  if (!nameSnapshot) return { ok: false, status: 400, error: "請選擇信眾，或至少輸入姓名" };

  const created = await prisma.$transaction(async (tx) => {
    const registration = await tx.stoveMasterRegistration.create({
      data: {
        templeEventId,
        year: event.year,
        roleType: input.roleType,
        memberId,
        householdId,
        nameSnapshot,
        phoneSnapshot,
        note: input.note?.trim() || null,
        createdByName: operatorName?.trim() || null,
      },
    });
    await recordVersion(
      {
        entityType: "StoveMasterRegistration",
        entityId: registration.id,
        action: "CREATE",
        afterData: registration,
        operatorName,
      },
      tx
    );
    return registration;
  });

  return { ok: true, data: { id: created.id } };
}

export async function setStoveMasterStatus(
  id: string,
  status: StoveMasterStatus,
  operatorName?: string | null
): Promise<StoveMasterResult<{ id: string }>> {
  const existing = await prisma.stoveMasterRegistration.findUnique({ where: { id } });
  if (!existing) return { ok: false, status: 404, error: "找不到這筆爐主／副爐主登錄" };

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.stoveMasterRegistration.update({ where: { id }, data: { status } });
    await recordVersion(
      {
        entityType: "StoveMasterRegistration",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: u,
        operatorName,
      },
      tx
    );
    return u;
  });
  return { ok: true, data: { id: updated.id } };
}
