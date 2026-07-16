import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V8.0「資料版本紀錄」的「回復到指定版本」邏輯。
 *
 * 設計原則：
 * - 只有 action 是 CREATE 或 UPDATE 的版本紀錄才有完整的 afterData 快照，
 *   可以拿來當作「回復目標」；DELETE/PURGE/RESTORE 這幾種紀錄不支援直接
 *   回復欄位值（DELETE 請改用回收區的「還原」，見 src/lib/recycleBin.ts）。
 * - 回復動作本身也會建立一筆新的 RecordVersion（action=RESTORE），讓歷史
 *   紀錄本身「回復到舊版本」這件事也留下軌跡，不會讓時間軸出現空洞。
 * - 每一種 entityType 只回復自己「可修改欄位」的白名單，不會把 id／
 *   createdAt／updatedAt／關聯外鍵等欄位也一起寫回去。
 */

export type RestoreVersionResult =
  | { ok: true; revalidatePaths: string[] }
  | { ok: false; status: number; error: string };

async function restoreHousehold(
  entityId: string,
  afterData: Record<string, unknown>,
  operatorName: string | null
): Promise<RestoreVersionResult> {
  const existing = await prisma.household.findUnique({ where: { id: entityId } });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "找不到這個家戶（如果已經在回收區，請先還原）" };
  }
  const patch = {
    contactName: (afterData.contactName as string | null) ?? null,
    phone: (afterData.phone as string | null) ?? null,
    address: (afterData.address as string | null) ?? null,
    companyName: (afterData.companyName as string | null) ?? null,
    notes: (afterData.notes as string | null) ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const restored = await tx.household.update({ where: { id: entityId }, data: patch });
    await recordVersion(
      {
        entityType: "Household",
        entityId,
        action: "RESTORE",
        beforeData: existing,
        afterData: restored,
        operatorName,
      },
      tx
    );
  });
  return { ok: true, revalidatePaths: [`/household/${entityId}`] };
}

async function restoreUniversalSalvationDetail(
  entityId: string,
  afterData: Record<string, unknown>,
  operatorName: string | null
): Promise<RestoreVersionResult> {
  const existing = await prisma.universalSalvationDetail.findUnique({
    where: { id: entityId },
    include: { ritualRecord: true },
  });
  if (!existing || existing.ritualRecord.deletedAt) {
    return {
      ok: false,
      status: 404,
      error: "找不到這筆普渡登記明細（如果已經在回收區，請先還原）",
    };
  }
  const patch = {
    isRegistered: Boolean(afterData.isRegistered),
    yangshangName: (afterData.yangshangName as string | null) ?? null,
    enshrinementLocation: (afterData.enshrinementLocation as string | null) ?? null,
    isSponsor: Boolean(afterData.isSponsor),
    sponsorQuantity: (afterData.sponsorQuantity as number | null) ?? null,
    // sponsorUnitPrice／sponsorAmount 是 Decimal 欄位：存進 RecordVersion 的
    // JSON 快照時，Decimal.toJSON() 會轉成字串，所以這裡讀回來可能是
    // string 也可能是 number，Prisma 的 Decimal 欄位兩種輸入都接受。
    sponsorUnitPrice: (afterData.sponsorUnitPrice as number | string | null) ?? null,
    sponsorAmount: (afterData.sponsorAmount as number | string | null) ?? null,
    sponsorNotes: (afterData.sponsorNotes as string | null) ?? null,
    tableNumber: (afterData.tableNumber as string | null) ?? null,
    notes: (afterData.notes as string | null) ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const restored = await tx.universalSalvationDetail.update({
      where: { id: entityId },
      data: patch,
    });
    await recordVersion(
      {
        entityType: "UniversalSalvationDetail",
        entityId,
        action: "RESTORE",
        beforeData: existing,
        afterData: restored,
        operatorName,
      },
      tx
    );
  });
  return {
    ok: true,
    revalidatePaths: [`/household/${existing.ritualRecord.householdId}/rituals/universal-salvation`],
  };
}

async function restoreUniversalSalvationEntry(
  entityId: string,
  afterData: Record<string, unknown>,
  operatorName: string | null
): Promise<RestoreVersionResult> {
  const existing = await prisma.universalSalvationEntry.findUnique({
    where: { id: entityId },
    include: { universalSalvation: { include: { ritualRecord: true } } },
  });
  if (!existing || existing.deletedAt || existing.universalSalvation.ritualRecord.deletedAt) {
    return {
      ok: false,
      status: 404,
      error: "找不到這筆登記項目（如果已經在回收區，請先還原）",
    };
  }
  const patch = {
    displayName: (afterData.displayName as string) ?? existing.displayName,
    yangshangName: (afterData.yangshangName as string | null) ?? null,
    notes: (afterData.notes as string | null) ?? null,
  };
  await prisma.$transaction(async (tx) => {
    const restored = await tx.universalSalvationEntry.update({
      where: { id: entityId },
      data: patch,
    });
    await recordVersion(
      {
        entityType: "UniversalSalvationEntry",
        entityId,
        action: "RESTORE",
        beforeData: existing,
        afterData: restored,
        operatorName,
      },
      tx
    );
  });
  return {
    ok: true,
    revalidatePaths: [
      `/household/${existing.universalSalvation.ritualRecord.householdId}/rituals/universal-salvation`,
    ],
  };
}

const RESTORE_HANDLERS: Record<
  string,
  (
    entityId: string,
    afterData: Record<string, unknown>,
    operatorName: string | null
  ) => Promise<RestoreVersionResult>
> = {
  Household: restoreHousehold,
  UniversalSalvationDetail: restoreUniversalSalvationDetail,
  UniversalSalvationEntry: restoreUniversalSalvationEntry,
};

/** 回復到某一筆歷史版本（versionId 指向的 RecordVersion）。 */
export async function restoreToVersion(
  entityType: string,
  entityId: string,
  versionId: string,
  operatorName: string | null
): Promise<RestoreVersionResult> {
  const version = await prisma.recordVersion.findUnique({ where: { id: versionId } });
  if (!version || version.entityType !== entityType || version.entityId !== entityId) {
    return { ok: false, status: 404, error: "找不到這筆版本紀錄" };
  }
  if (version.action !== "CREATE" && version.action !== "UPDATE") {
    return {
      ok: false,
      status: 400,
      error: "這筆紀錄沒有可以回復的欄位內容（刪除紀錄請改用回收區還原）",
    };
  }
  if (!version.afterData || typeof version.afterData !== "object") {
    return { ok: false, status: 400, error: "這筆版本紀錄沒有完整的資料快照，無法回復" };
  }

  const handler = RESTORE_HANDLERS[entityType];
  if (!handler) {
    return { ok: false, status: 400, error: "這種資料類型目前不支援回復到指定版本" };
  }

  return handler(entityId, version.afterData as Record<string, unknown>, operatorName);
}
