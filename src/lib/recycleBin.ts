import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { additionalPrintItemTypeLabel } from "@/lib/labels";

/**
 * V8.0「刪除保護（回收區）」核心邏輯。
 *
 * 對應需求「五、刪除保護」：
 * - 重要資料不得直接永久刪除，刪除時先移至回收區（軟刪除：設定 deletedAt/
 *   deletedByName，不是真的執行 SQL DELETE）。
 * - 至少保留 30 天，管理者可恢復；超過保留期限才可永久刪除。
 *
 * 目前套用範圍（誠實說明，見交付說明「已知限制」）：
 * - 系統目前只有「普渡登記」（RitualRecord + UniversalSalvationEntry）真的
 *   有刪除功能／畫面／API，所以這一輪只把這兩種資料接上軟刪除。
 * - Household／Member 兩張表已經先加上 deletedAt/deletedByName 欄位、
 *   也已經在下面的回收區清單/還原/永久刪除邏輯裡一併支援，但因為系統目前
 *   完全沒有「刪除家戶」「刪除信眾成員」的功能或按鈕，這輪不會新增這兩個
 *   刪除入口——之後如果要開放這兩個刪除功能，直接呼叫這裡的
 *   softDeleteHousehold()／softDeleteMember() 即可，不需要重新設計回收區。
 *
 * ⚠️ 權限：需求「九、權限」要求只有 SUPER_ADMIN 能還原資料／永久刪除。
 * 系統目前沒有登入/session 機制（src/lib/permissions.ts 的
 * getCurrentUser() 固定回傳 null），沒有辦法在後端真正驗證「目前操作的人
 * 是不是 SUPER_ADMIN」。這裡先把回收區的 API 開放給所有使用者操作，並在
 * 畫面上清楚標示這個限制，等系統做出登入/session 機制後，才能把這個限制
 * 從「畫面提示」升級成「後端強制擋下」。
 */

export const RECYCLE_BIN_RETENTION_DAYS = 30;

export type RecycleBinEntityType =
  | "Household"
  | "Member"
  | "RitualRecord"
  | "UniversalSalvationEntry"
  | "AdditionalPrintItem"
  | "OfferingClaim";

export type RecycleBinItem = {
  entityType: RecycleBinEntityType;
  entityId: string;
  entityTypeLabel: string;
  displayName: string;
  context: string | null;
  deletedAt: Date;
  deletedByName: string | null;
  daysRemaining: number;
  canPurge: boolean;
};

export const recycleBinEntityTypeLabel: Record<RecycleBinEntityType, string> = {
  Household: "家戶資料",
  Member: "信眾成員",
  RitualRecord: "普渡登記",
  UniversalSalvationEntry: "普渡登記項目",
  AdditionalPrintItem: "附加列印項目",
  OfferingClaim: "供品認捐",
};

function daysRemainingOf(deletedAt: Date): number {
  const elapsedMs = Date.now() - deletedAt.getTime();
  const elapsedDays = elapsedMs / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.ceil(RECYCLE_BIN_RETENTION_DAYS - elapsedDays));
}

function canPurgeOf(deletedAt: Date): boolean {
  return daysRemainingOf(deletedAt) <= 0;
}

async function listHouseholdItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.household.findMany({ where: { deletedAt: { not: null } } });
  return rows.map((h) => ({
    entityType: "Household" as const,
    entityId: h.id,
    entityTypeLabel: recycleBinEntityTypeLabel.Household,
    displayName: `${h.name}（${h.id}）`,
    context: h.contactName ? `主要聯絡人：${h.contactName}` : null,
    deletedAt: h.deletedAt!,
    deletedByName: h.deletedByName,
    daysRemaining: daysRemainingOf(h.deletedAt!),
    canPurge: canPurgeOf(h.deletedAt!),
  }));
}

async function listMemberItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.member.findMany({
    where: { deletedAt: { not: null } },
    include: { household: true },
  });
  return rows.map((m) => ({
    entityType: "Member" as const,
    entityId: m.id,
    entityTypeLabel: recycleBinEntityTypeLabel.Member,
    displayName: m.name,
    context: `${m.household.name}（${m.household.id}）`,
    deletedAt: m.deletedAt!,
    deletedByName: m.deletedByName,
    daysRemaining: daysRemainingOf(m.deletedAt!),
    canPurge: canPurgeOf(m.deletedAt!),
  }));
}

async function listRitualRecordItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.ritualRecord.findMany({
    where: { deletedAt: { not: null } },
    include: { household: true },
  });
  return rows.map((r) => ({
    entityType: "RitualRecord" as const,
    entityId: r.id,
    entityTypeLabel: recycleBinEntityTypeLabel.RitualRecord,
    displayName: `${r.household.name}（${r.household.id}）${r.year} 年普渡登記`,
    context: null,
    deletedAt: r.deletedAt!,
    deletedByName: r.deletedByName,
    daysRemaining: daysRemainingOf(r.deletedAt!),
    canPurge: canPurgeOf(r.deletedAt!),
  }));
}

async function listUniversalSalvationEntryItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.universalSalvationEntry.findMany({
    where: { deletedAt: { not: null } },
    include: {
      universalSalvation: { include: { ritualRecord: { include: { household: true } } } },
    },
  });
  return rows.map((e) => ({
    entityType: "UniversalSalvationEntry" as const,
    entityId: e.id,
    entityTypeLabel: recycleBinEntityTypeLabel.UniversalSalvationEntry,
    displayName: e.displayName,
    context: `${e.universalSalvation.ritualRecord.household.name}（${e.universalSalvation.ritualRecord.household.id}）${e.universalSalvation.ritualRecord.year} 年普渡`,
    deletedAt: e.deletedAt!,
    deletedByName: e.deletedByName,
    daysRemaining: daysRemainingOf(e.deletedAt!),
    canPurge: canPurgeOf(e.deletedAt!),
  }));
}

/**
 * V9.1「附加列印項目」移入回收區的項目——見
 * src/lib/additionalPrintItems.ts 的 moveAdditionalPrintItemToRecycleBin()
 * 說明：只有已經是「取消」狀態的項目才會被移入這裡，deletedAt 只代表
 * 「已進入永久刪除流程」，不影響 status 欄位本身（status 仍然是
 * CANCELLED，還原時也不會被改動）。
 */
async function listAdditionalPrintItemItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.additionalPrintItem.findMany({
    where: { deletedAt: { not: null } },
    include: { household: true },
  });
  return rows.map((item) => ({
    entityType: "AdditionalPrintItem" as const,
    entityId: item.id,
    entityTypeLabel: recycleBinEntityTypeLabel.AdditionalPrintItem,
    displayName: `${additionalPrintItemTypeLabel[item.itemType] ?? item.itemType}：${item.printName}（${
      item.isExtra ? "額外" : "預設"
    }）`,
    context: `${item.household.name}（${item.household.id}）`,
    deletedAt: item.deletedAt!,
    deletedByName: item.deletedByName,
    daysRemaining: daysRemainingOf(item.deletedAt!),
    canPurge: canPurgeOf(item.deletedAt!),
  }));
}

/**
 * V10.1「供品認捐中心」移入回收區的項目——見 src/lib/offeringClaims.ts 的
 * moveOfferingClaimToRecycleBin() 說明：只有已經是「取消」或「已完成
 * 退款/轉款」狀態的認捐才會被移入這裡，deletedAt 只代表「已進入永久刪除
 * 流程」，不影響 status 欄位本身（還原後 status 仍維持原狀，不會自動
 * 變回「有效」——如果要恢復成有效認捐，需要另外呼叫
 * src/lib/offeringClaims.ts 的 restoreOfferingClaim()，這是兩個不同的
 * 操作，比照 AdditionalPrintItem 的既有慣例）。
 */
async function listOfferingClaimItems(): Promise<RecycleBinItem[]> {
  const rows = await prisma.offeringClaim.findMany({
    where: { deletedAt: { not: null } },
    include: { offeringType: true, sponsorHousehold: true },
  });
  return rows.map((claim) => ({
    entityType: "OfferingClaim" as const,
    entityId: claim.id,
    entityTypeLabel: recycleBinEntityTypeLabel.OfferingClaim,
    displayName: `${claim.offeringType.name}：${claim.sponsorNameSnapshot}（${claim.year} 年）`,
    context: `${claim.sponsorHousehold.name}（${claim.sponsorHousehold.id}）`,
    deletedAt: claim.deletedAt!,
    deletedByName: claim.deletedByName,
    daysRemaining: daysRemainingOf(claim.deletedAt!),
    canPurge: canPurgeOf(claim.deletedAt!),
  }));
}

/** 回收區完整清單（跨所有支援的資料類型），依刪除時間由新到舊排序。 */
export async function listRecycleBin(): Promise<RecycleBinItem[]> {
  const [households, members, rituals, entries, additionalPrintItems, offeringClaims] = await Promise.all([
    listHouseholdItems(),
    listMemberItems(),
    listRitualRecordItems(),
    listUniversalSalvationEntryItems(),
    listAdditionalPrintItemItems(),
    listOfferingClaimItems(),
  ]);
  return [...households, ...members, ...rituals, ...entries, ...additionalPrintItems, ...offeringClaims].sort(
    (a, b) => b.deletedAt.getTime() - a.deletedAt.getTime()
  );
}

export type RecycleBinResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** 從回收區還原一筆資料（設回 deletedAt=null），並留下 RESTORE 版本紀錄。 */
export async function restoreRecycleBinItem(
  entityType: RecycleBinEntityType,
  entityId: string,
  operatorName: string | null
): Promise<RecycleBinResult> {
  switch (entityType) {
    case "Household": {
      const existing = await prisma.household.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆家戶資料" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.household.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          { entityType: "Household", entityId, action: "RESTORE", afterData: restored, operatorName },
          tx
        );
      });
      return { ok: true };
    }
    case "Member": {
      const existing = await prisma.member.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆信眾成員資料" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.member.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          { entityType: "Member", entityId, action: "RESTORE", afterData: restored, operatorName },
          tx
        );
      });
      return { ok: true };
    }
    case "RitualRecord": {
      const existing = await prisma.ritualRecord.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆普渡登記資料" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.ritualRecord.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          { entityType: "RitualRecord", entityId, action: "RESTORE", afterData: restored, operatorName },
          tx
        );
      });
      return { ok: true };
    }
    case "UniversalSalvationEntry": {
      const existing = await prisma.universalSalvationEntry.findUnique({
        where: { id: entityId },
      });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆普渡登記項目" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.universalSalvationEntry.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          {
            entityType: "UniversalSalvationEntry",
            entityId,
            action: "RESTORE",
            afterData: restored,
            operatorName,
          },
          tx
        );
      });
      return { ok: true };
    }
    case "AdditionalPrintItem": {
      const existing = await prisma.additionalPrintItem.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆附加列印項目" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.additionalPrintItem.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          {
            entityType: "AdditionalPrintItem",
            entityId,
            action: "RESTORE",
            afterData: restored,
            operatorName,
          },
          tx
        );
      });
      return { ok: true };
    }
    case "OfferingClaim": {
      const existing = await prisma.offeringClaim.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆供品認捐資料" };
      }
      await prisma.$transaction(async (tx) => {
        const restored = await tx.offeringClaim.update({
          where: { id: entityId },
          data: { deletedAt: null, deletedByName: null },
        });
        await recordVersion(
          { entityType: "OfferingClaim", entityId, action: "RESTORE", afterData: restored, operatorName },
          tx
        );
      });
      return { ok: true };
    }
    default:
      return { ok: false, status: 400, error: "不支援的資料類型" };
  }
}

/** 從回收區永久刪除一筆資料。只有超過保留期限（30 天）才允許執行。 */
export async function purgeRecycleBinItem(
  entityType: RecycleBinEntityType,
  entityId: string
): Promise<RecycleBinResult> {
  switch (entityType) {
    case "Household": {
      const existing = await prisma.household.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆家戶資料" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "Household", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.household.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    case "Member": {
      const existing = await prisma.member.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆信眾成員資料" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "Member", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.member.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    case "RitualRecord": {
      const existing = await prisma.ritualRecord.findUnique({
        where: { id: entityId },
        include: { universalSalvation: { include: { entries: true } } },
      });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆普渡登記資料" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "RitualRecord", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.ritualRecord.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    case "UniversalSalvationEntry": {
      const existing = await prisma.universalSalvationEntry.findUnique({
        where: { id: entityId },
      });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆普渡登記項目" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "UniversalSalvationEntry", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.universalSalvationEntry.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    case "AdditionalPrintItem": {
      const existing = await prisma.additionalPrintItem.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆附加列印項目" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "AdditionalPrintItem", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.additionalPrintItem.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    case "OfferingClaim": {
      const existing = await prisma.offeringClaim.findUnique({ where: { id: entityId } });
      if (!existing || !existing.deletedAt) {
        return { ok: false, status: 404, error: "回收區找不到這筆供品認捐資料" };
      }
      if (!canPurgeOf(existing.deletedAt)) {
        return {
          ok: false,
          status: 400,
          error: `尚未超過 ${RECYCLE_BIN_RETENTION_DAYS} 天保留期限，還不能永久刪除`,
        };
      }
      await prisma.$transaction(async (tx) => {
        await recordVersion(
          { entityType: "OfferingClaim", entityId, action: "PURGE", beforeData: existing },
          tx
        );
        await tx.offeringPayment.deleteMany({ where: { offeringClaimId: entityId } });
        await tx.offeringClaim.delete({ where: { id: entityId } });
      });
      return { ok: true };
    }
    default:
      return { ok: false, status: 400, error: "不支援的資料類型" };
  }
}

export function isRecycleBinEntityType(value: unknown): value is RecycleBinEntityType {
  return (
    value === "Household" ||
    value === "Member" ||
    value === "RitualRecord" ||
    value === "UniversalSalvationEntry" ||
    value === "AdditionalPrintItem" ||
    value === "OfferingClaim"
  );
}
