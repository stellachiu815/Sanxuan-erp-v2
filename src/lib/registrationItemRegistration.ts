import { prisma } from "@/lib/prisma";
import type { Prisma, ActivityType } from "@prisma/client";
import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
import { upsertLanternRegistrationInTransaction } from "@/lib/lanternRegistration";
import {
  getRegistrationItemTypeById,
  computeItemAmountDue,
} from "@/lib/registrationItems";

/**
 * V14：把報名項目回寫到既有明細表，並回填 linkedEntryId／linkedEntryType。
 *
 * ⚠️ 避免「兩筆應收」（指令七）：對於已有既有收款來源的內容型態，金額一律
 * 記在既有明細，RitualRegistrationItem 的金額歸零、只當索引與列印入口。
 *   LANTERN → LanternRegistration（既有年度燈收款來源）
 *   SPONSOR → UniversalSalvationDetail（既有普渡贊普收款來源）
 * 沒有既有收款表的內容型態（RICE/TABLE/ROSTER/龍鳳燈）則由
 * RitualRegistrationItem 自己作為收款來源（見 receivableAdapters）。
 * 需要專屬編號／互斥規則的型態（TABLET/POCKET/PURIFICATION/TURTLE/STOVE）
 * 仍由既有專屬流程建立內容，這裡只保留索引，不重複建立第二套明細。
 */
async function linkItemToExistingDetail(
  tx: Prisma.TransactionClient,
  params: {
    registrationItemId: string;
    contentKind: string;
    activityType: ActivityType;
    ritualRecordId: string;
    itemAmountDue: number;
    unitPrice: number | null;
    participantCount: number;
    operatorName?: string | null;
  }
): Promise<void> {
  if (params.contentKind === "LANTERN") {
    const res = await upsertLanternRegistrationInTransaction(tx, {
      ritualRecordId: params.ritualRecordId,
      activityType: params.activityType,
      participantCount: Math.max(1, params.participantCount),
      unitPrice: params.unitPrice,
      operatorName: params.operatorName,
    });
    if (!res.ok) throw new Error(res.error);
    const reg = await tx.lanternRegistration.findUnique({
      where: { ritualRecordId: params.ritualRecordId },
      select: { id: true },
    });
    // 金額記在 LanternRegistration；本項目金額歸零，避免兩筆應收。
    await tx.ritualRegistrationItem.update({
      where: { id: params.registrationItemId },
      data: {
        amountDue: 0,
        amountUnpaid: 0,
        linkedEntryType: "LanternRegistration",
        linkedEntryId: reg?.id ?? null,
      },
    });
    return;
  }

  if (params.contentKind === "SPONSOR") {
    // 普渡贊普：金額寫進既有 UniversalSalvationDetail（既有贊普收款來源）。
    const detail = await tx.universalSalvationDetail.upsert({
      where: { ritualRecordId: params.ritualRecordId },
      create: {
        ritualRecordId: params.ritualRecordId,
        isRegistered: true,
        isSponsor: true,
        sponsorAmount: params.itemAmountDue,
        amountDue: params.itemAmountDue,
        amountUnpaid: params.itemAmountDue,
      },
      update: {
        isSponsor: true,
        sponsorAmount: params.itemAmountDue,
        amountDue: params.itemAmountDue,
        amountUnpaid: params.itemAmountDue,
      },
      select: { id: true },
    });
    await tx.ritualRegistrationItem.update({
      where: { id: params.registrationItemId },
      data: {
        amountDue: 0,
        amountUnpaid: 0,
        linkedEntryType: "UniversalSalvationDetail",
        linkedEntryId: detail.id,
      },
    });
    return;
  }
  // 其餘型態：本項目自身即為索引（RICE/TABLE/ROSTER/龍鳳燈由自身 adapter 收款；
  // TABLET/POCKET/PURIFICATION/TURTLE/STOVE 由既有專屬流程建立內容）。
}

/**
 * V14：報名項目的寫入 service（RitualRecord 之下的 RitualRegistrationItem）。
 *
 * ⚠️ 不是第二套報名主檔：
 * - 主檔仍是既有 RitualRecord（@@unique[householdId, year, activityType]）。
 * - 同戶同年同活動 = 唯一一筆 RitualRecord；多個項目掛在它底下。
 * - 成員沿用既有 RitualParticipant。
 * - 內容（牌位／寶袋／供品…）仍指回既有明細表，本表只存「項目層索引＋財務」。
 *
 * 同一位信眾可在同一主活動下報名多個不同項目（指令三）：因為每個項目是
 * 獨立一筆 RitualRegistrationItem。是否允許同一項目多筆，依
 * RegistrationItemType.allowMultiplePerMember 決定。
 */

export type RegisterItemInput = {
  /** 報名項目設定 id（RegistrationItemType）。 */
  registrationItemTypeId: string;
  /** 這個項目寫入的年度（民國年）。 */
  year: number;
  /** 主報名人（用來定位家戶）。 */
  memberId: string;
  /** 本項目納入的成員（個人項目通常就是本人；家戶項目可空）。 */
  participantMemberIds?: string[];
  quantity?: number;
  customName?: string | null;
  customAmount?: number | null;
  feeChoice?: "FIXED" | "CUSTOM" | null;
  operatorName?: string | null;
};

export type RegisterItemResult =
  | {
      ok: true;
      ritualRecordId: string;
      registrationItemId: string;
      amountDue: number;
      createdRecord: boolean;
    }
  | { ok: false; status: number; error: string };

/** 找出（或建立）某戶某年某活動類型的 RitualRecord。 */
async function ensureRitualRecord(
  tx: Prisma.TransactionClient,
  params: { householdId: string; year: number; activityType: ActivityType; operatorName?: string | null }
): Promise<{ id: string; created: boolean } | { error: string }> {
  const existing = await tx.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId: params.householdId,
        year: params.year,
        activityType: params.activityType,
      },
    },
    select: { id: true, deletedAt: true },
  });
  if (existing && existing.deletedAt) {
    return { error: `這一戶民國 ${params.year} 年的這個活動報名目前在回收區，請先還原後再新增項目` };
  }
  let recordId: string;
  let created: boolean;
  if (existing) {
    recordId = existing.id;
    created = false;
  } else {
    // 對應這個活動類型與年度的 TempleEvent（可為 null；沿用既有可空慣例）。
    const event = await tx.templeEvent.findUnique({
      where: { activityType_year: { activityType: params.activityType, year: params.year } },
      select: { id: true },
    });
    const rec = await tx.ritualRecord.create({
      data: {
        householdId: params.householdId,
        year: params.year,
        activityType: params.activityType,
        templeEventId: event?.id ?? null,
        status: "DRAFT",
        registrationSource: "DEVOTEE_PAGE",
      },
      select: { id: true },
    });
    recordId = rec.id;
    created = true;
  }

  // V14.1：普渡報名一律 1:1 對應一筆 UniversalSalvationDetail。沒有它，普渡
  // 編輯器會顯示「尚未建立登記明細」。這裡在建立／沿用報名時就同步確保明細
  // 存在，不等使用者第一次打開才建。upsert 冪等，既有明細不覆蓋。
  if (params.activityType === "UNIVERSAL_SALVATION") {
    await tx.universalSalvationDetail.upsert({
      where: { ritualRecordId: recordId },
      create: { ritualRecordId: recordId, isRegistered: true },
      update: {},
    });
  }

  return { id: recordId, created };
}

/**
 * 報名一個項目。已存在同戶同年同活動時沿用既有 RitualRecord，只新增項目
 * （不是錯誤、不建立第二筆主檔）。
 */
export async function registerItem(input: RegisterItemInput): Promise<RegisterItemResult> {
  const itemType = await getRegistrationItemTypeById(input.registrationItemTypeId);
  if (!itemType) {
    return { ok: false, status: 404, error: "找不到這個報名項目設定" };
  }

  const member = await prisma.member.findFirst({
    where: { id: input.memberId, deletedAt: null },
    select: { id: true, householdId: true },
  });
  if (!member) return { ok: false, status: 404, error: "找不到這位信眾" };

  const quantity = input.quantity ?? itemType.defaultQuantity;
  const amount = computeItemAmountDue({
    feeMode: itemType.feeMode,
    defaultUnitPrice: itemType.defaultUnitPrice,
    quantity,
    customAmount: input.customAmount ?? null,
    feeChoice: input.feeChoice ?? null,
  });
  if (!amount.ok) return { ok: false, status: 400, error: amount.reason };

  try {
    return await prisma.$transaction(async (tx) => {
      const rec = await ensureRitualRecord(tx, {
        householdId: member.householdId,
        year: input.year,
        activityType: itemType.activityType,
        operatorName: input.operatorName,
      });
      if ("error" in rec) return { ok: false as const, status: 409, error: rec.error };

      // 單一項目（allowMultiplePerMember=false）時，避免同一成員重複建立。
      if (!itemType.allowMultiplePerMember && input.memberId) {
        const dup = await tx.ritualRegistrationItem.findFirst({
          where: {
            ritualRecordId: rec.id,
            registrationItemTypeId: itemType.id,
            memberId: input.memberId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (dup) {
          return {
            ok: false as const,
            status: 409,
            error: `這位信眾在此活動已報名「${itemType.name}」，此項目不允許重複報名`,
          };
        }
      }

      const created = await tx.ritualRegistrationItem.create({
        data: {
          ritualRecordId: rec.id,
          registrationItemTypeId: itemType.id,
          memberId: input.memberId ?? null,
          quantity,
          customName: input.customName ?? null,
          amountDue: amount.amountDue,
          amountPaid: 0,
          amountUnpaid: amount.amountDue,
          feeChoice: input.feeChoice ?? null,
          status: "DRAFT",
        },
        select: { id: true },
      });

      const participantIds =
        input.participantMemberIds && input.participantMemberIds.length > 0
          ? input.participantMemberIds
          : input.memberId
            ? [input.memberId]
            : [];
      if (participantIds.length > 0) {
        await upsertParticipantsInTransaction(tx, rec.id, participantIds, input.operatorName ?? null);
      }

      // 回寫既有明細並回填 linkedEntryId／linkedEntryType（避免兩筆應收）。
      await linkItemToExistingDetail(tx, {
        registrationItemId: created.id,
        contentKind: itemType.contentKind,
        activityType: itemType.activityType,
        ritualRecordId: rec.id,
        itemAmountDue: amount.amountDue,
        unitPrice: itemType.defaultUnitPrice,
        participantCount: participantIds.length,
        operatorName: input.operatorName,
      });

      return {
        ok: true as const,
        ritualRecordId: rec.id,
        registrationItemId: created.id,
        amountDue: amount.amountDue,
        createdRecord: rec.created,
      };
    });
  } catch (e) {
    // 不吞錯回成功、不把失敗當 0（指令十）。
    const msg = e instanceof Error ? e.message : "報名項目時發生未預期錯誤";
    return { ok: false, status: 500, error: msg };
  }
}

/**
 * V14.1：整批多人多項報名（信眾詳情頁多選、活動中心整戶報名共用）。
 *
 * ⚠️ 全部在**單一交易**內完成（指令九）：任一必要資料失敗 → 全部 rollback，
 * 不會只寫一半。每位成員連到正確的既有 RitualRecord（同戶同年同活動唯一一筆），
 * 每個項目建立自己的 RitualRegistrationItem，並回寫既有明細與 linkedEntry。
 * 已存在且未取消的相同項目**不重複建立**（回報 ALREADY 由呼叫端提示可編輯）。
 */
export type BatchItemEntry = {
  memberId: string;
  registrationItemTypeId: string;
  year: number;
  quantity?: number;
  customName?: string | null;
  customAmount?: number | null;
  feeChoice?: "FIXED" | "CUSTOM" | null;
};

export type BatchItemOutcome = {
  memberId: string;
  registrationItemTypeId: string;
  outcome: "CREATED" | "ALREADY_EXISTS";
  registrationItemId: string | null;
  ritualRecordId: string;
  amountDue: number;
};

export type BatchResult =
  | { ok: true; outcomes: BatchItemOutcome[]; ritualRecordIds: string[] }
  | { ok: false; status: number; error: string };

export async function registerItemsBatch(
  entries: BatchItemEntry[],
  operatorName?: string | null
): Promise<BatchResult> {
  if (entries.length === 0) return { ok: false, status: 400, error: "沒有要報名的項目" };

  // 先把所有項目設定與成員家戶一次撈齊（避免交易內 N+1）。
  const itemTypeIds = Array.from(new Set(entries.map((e) => e.registrationItemTypeId)));
  const memberIds = Array.from(new Set(entries.map((e) => e.memberId)));
  const [itemTypes, members] = await Promise.all([
    prisma.registrationItemType.findMany({ where: { id: { in: itemTypeIds } } }),
    prisma.member.findMany({ where: { id: { in: memberIds }, deletedAt: null }, select: { id: true, householdId: true } }),
  ]);
  const itemTypeMap = new Map(itemTypes.map((t) => [t.id, t]));
  const memberMap = new Map(members.map((m) => [m.id, m]));

  // 先驗證與預算金額（交易外，快速失敗）。
  type Prepared = { entry: BatchItemEntry; itemType: (typeof itemTypes)[number]; householdId: string; quantity: number; amountDue: number };
  const prepared: Prepared[] = [];
  for (const entry of entries) {
    const itemType = itemTypeMap.get(entry.registrationItemTypeId);
    if (!itemType) return { ok: false, status: 404, error: "找不到報名項目設定" };
    const member = memberMap.get(entry.memberId);
    if (!member) return { ok: false, status: 404, error: "找不到報名成員" };
    const quantity = entry.quantity ?? itemType.defaultQuantity;
    const amount = computeItemAmountDue({
      feeMode: itemType.feeMode as never,
      defaultUnitPrice: itemType.defaultUnitPrice === null ? null : Number(itemType.defaultUnitPrice),
      quantity,
      customAmount: entry.customAmount ?? null,
      feeChoice: entry.feeChoice ?? null,
    });
    if (!amount.ok) return { ok: false, status: 400, error: `${itemType.name}：${amount.reason}` };
    prepared.push({ entry, itemType, householdId: member.householdId, quantity, amountDue: amount.amountDue });
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const outcomes: BatchItemOutcome[] = [];
      const recordIds = new Set<string>();
      // 同一戶同年同活動只解析一次 RitualRecord。
      const recordCache = new Map<string, string>();

      for (const p of prepared) {
        const recKey = `${p.householdId}::${p.entry.year}::${p.itemType.activityType}`;
        let recordId = recordCache.get(recKey);
        if (!recordId) {
          const rec = await ensureRitualRecord(tx, {
            householdId: p.householdId,
            year: p.entry.year,
            activityType: p.itemType.activityType,
            operatorName,
          });
          if ("error" in rec) return { ok: false as const, status: 409, error: rec.error };
          recordId = rec.id;
          recordCache.set(recKey, recordId);
        }
        recordIds.add(recordId);

        // 不重複建立同一成員同一項目（未取消、未刪除）。
        if (!p.itemType.allowMultiplePerMember) {
          const dup = await tx.ritualRegistrationItem.findFirst({
            where: {
              ritualRecordId: recordId,
              registrationItemTypeId: p.itemType.id,
              memberId: p.entry.memberId,
              deletedAt: null,
              status: { not: "CANCELLED" },
            },
            select: { id: true },
          });
          if (dup) {
            outcomes.push({
              memberId: p.entry.memberId,
              registrationItemTypeId: p.itemType.id,
              outcome: "ALREADY_EXISTS",
              registrationItemId: dup.id,
              ritualRecordId: recordId,
              amountDue: 0,
            });
            continue;
          }
        }

        const created = await tx.ritualRegistrationItem.create({
          data: {
            ritualRecordId: recordId,
            registrationItemTypeId: p.itemType.id,
            memberId: p.entry.memberId,
            quantity: p.quantity,
            customName: p.entry.customName ?? null,
            amountDue: p.amountDue,
            amountPaid: 0,
            amountUnpaid: p.amountDue,
            feeChoice: p.entry.feeChoice ?? null,
            status: "DRAFT",
          },
          select: { id: true },
        });

        await upsertParticipantsInTransaction(tx, recordId, [p.entry.memberId], operatorName ?? null);

        await linkItemToExistingDetail(tx, {
          registrationItemId: created.id,
          contentKind: p.itemType.contentKind,
          activityType: p.itemType.activityType,
          ritualRecordId: recordId,
          itemAmountDue: p.amountDue,
          unitPrice: p.itemType.defaultUnitPrice === null ? null : Number(p.itemType.defaultUnitPrice),
          participantCount: 1,
          operatorName,
        });

        outcomes.push({
          memberId: p.entry.memberId,
          registrationItemTypeId: p.itemType.id,
          outcome: "CREATED",
          registrationItemId: created.id,
          ritualRecordId: recordId,
          amountDue: p.amountDue,
        });
      }

      return { ok: true as const, outcomes, ritualRecordIds: Array.from(recordIds) };
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "整批報名時發生未預期錯誤";
    return { ok: false, status: 500, error: msg };
  }
}

export type RegisteredItemView = {
  id: string;
  registrationItemTypeId: string;
  itemKey: string;
  itemName: string;
  activityGroupName: string;
  memberId: string | null;
  quantity: number;
  customName: string | null;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};

/** 列出某筆 RitualRecord 底下的報名項目（未刪除）。 */
export async function listRegisteredItems(ritualRecordId: string): Promise<RegisteredItemView[]> {
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: { ritualRecordId, deletedAt: null },
    include: { registrationItemType: true },
    orderBy: [{ registrationItemType: { sortOrder: "asc" } }, { createdAt: "asc" }],
  });
  return rows.map((r) => ({
    id: r.id,
    registrationItemTypeId: r.registrationItemTypeId,
    itemKey: r.registrationItemType.key,
    itemName: r.customName ?? r.registrationItemType.name,
    activityGroupName: r.registrationItemType.activityGroupName,
    memberId: r.memberId,
    quantity: r.quantity,
    customName: r.customName,
    amountDue: Number(r.amountDue),
    amountPaid: Number(r.amountPaid),
    amountUnpaid: Number(r.amountUnpaid),
    status: r.status,
  }));
}

/** 軟刪除一個報名項目（保留歷史）。 */
export async function removeRegisteredItem(
  registrationItemId: string,
  operatorName?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const item = await prisma.ritualRegistrationItem.findUnique({
    where: { id: registrationItemId },
    select: { id: true, deletedAt: true, amountPaid: true },
  });
  if (!item) return { ok: false, status: 404, error: "找不到這個報名項目" };
  if (item.deletedAt) return { ok: true };
  if (Number(item.amountPaid) > 0) {
    return { ok: false, status: 409, error: "此項目已有收款，請先於收款中心處理退款後再移除" };
  }
  await prisma.ritualRegistrationItem.update({
    where: { id: registrationItemId },
    data: { deletedAt: new Date(), deletedByName: operatorName ?? null },
  });
  return { ok: true };
}
