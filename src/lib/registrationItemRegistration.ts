import { prisma } from "@/lib/prisma";
import type { Prisma, ActivityType } from "@prisma/client";
import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
import { upsertLanternRegistrationInTransaction } from "@/lib/lanternRegistration";
import {
  getRegistrationItemTypeById,
  computeItemAmountDue,
} from "@/lib/registrationItems";
import {
  getUniversalSalvationTabletPrices,
  isUniversalSalvationTabletKey,
  tabletUnitPriceFor,
  type TabletUnitPrices,
} from "@/lib/universalSalvationTabletPricing";

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
    feeMode: string;
    activityType: ActivityType;
    ritualRecordId: string;
    itemAmountDue: number;
    unitPrice: number | null;
    quantity: number;
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
    // ⚠️ 同步初始化「贊普數量」，不再讓編輯頁顯示 0（V14.1 回歸修正一）。
    //
    // V14.1：贊普單價**來源是活動層 TempleEvent.sponsorUnitPrice**（宮方每年設定一次）。
    //   - 贊普（FIXED）：讀本筆報名所屬 TempleEvent.sponsorUnitPrice：
    //       尚未設定 → 保留數量、單價/金額皆 null/0（不默默用 0；confirm 會被擋）。
    //       已設定   → sponsorAmount = 數量 × 單價。
    //   - 隨喜贊普（CUSTOM）：金額為使用者自訂，已算進 itemAmountDue，單價不適用。
    let sponsorUnitPrice: number | null;
    let sponsorAmount: number;
    if (params.feeMode === "CUSTOM") {
      sponsorUnitPrice = null;
      sponsorAmount = params.itemAmountDue;
    } else {
      const rec = await tx.ritualRecord.findUnique({
        where: { id: params.ritualRecordId },
        select: { templeEvent: { select: { sponsorUnitPrice: true } } },
      });
      sponsorUnitPrice =
        rec?.templeEvent?.sponsorUnitPrice != null
          ? Number(rec.templeEvent.sponsorUnitPrice)
          : null;
      sponsorAmount =
        sponsorUnitPrice !== null
          ? Math.round(sponsorUnitPrice * params.quantity * 100) / 100
          : 0;
    }

    const detail = await tx.universalSalvationDetail.upsert({
      where: { ritualRecordId: params.ritualRecordId },
      create: {
        ritualRecordId: params.ritualRecordId,
        isRegistered: true,
        isSponsor: true,
        sponsorQuantity: params.quantity,
        sponsorUnitPrice,
        sponsorAmount,
        amountDue: sponsorAmount,
        amountUnpaid: sponsorAmount,
      },
      update: {
        isSponsor: true,
        sponsorQuantity: params.quantity,
        sponsorUnitPrice,
        sponsorAmount,
        amountDue: sponsorAmount,
        amountUnpaid: sponsorAmount,
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
  let amountDue: number;
  if (
    itemType.activityType === "UNIVERSAL_SALVATION" &&
    isUniversalSalvationTabletKey(itemType.key)
  ) {
    // V14.2：四類牌位應收 = 年度單價 × 數量（未設定 → 0，不寫死金額）。
    if (!Number.isInteger(quantity) || quantity < 1) {
      return { ok: false, status: 400, error: "數量必須是 1 以上的整數" };
    }
    const prices = await getUniversalSalvationTabletPrices(input.year);
    const unit = tabletUnitPriceFor(itemType.key, prices);
    amountDue = unit !== null ? Math.round(unit * quantity * 100) / 100 : 0;
  } else {
    const amount = computeItemAmountDue({
      feeMode: itemType.feeMode,
      defaultUnitPrice: itemType.defaultUnitPrice,
      quantity,
      customAmount: input.customAmount ?? null,
      feeChoice: input.feeChoice ?? null,
    });
    if (!amount.ok) return { ok: false, status: 400, error: amount.reason };
    amountDue = amount.amountDue;
  }

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
          amountDue,
          amountPaid: 0,
          amountUnpaid: amountDue,
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
        feeMode: itemType.feeMode,
        activityType: itemType.activityType,
        ritualRecordId: rec.id,
        itemAmountDue: amountDue,
        unitPrice: itemType.defaultUnitPrice,
        quantity,
        participantCount: participantIds.length,
        operatorName: input.operatorName,
      });

      return {
        ok: true as const,
        ritualRecordId: rec.id,
        registrationItemId: created.id,
        amountDue,
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

  // V14.2：先把中元普渡四類牌位的「年度單價」按年度一次撈齊（非 N+1）。
  // 這四類 feeMode=NONE、defaultUnitPrice=null，金額改由 TempleEvent 年度單價決定。
  const tabletPriceByYear = new Map<number, TabletUnitPrices>();
  for (const entry of entries) {
    const itemType = itemTypeMap.get(entry.registrationItemTypeId);
    if (
      itemType &&
      itemType.activityType === "UNIVERSAL_SALVATION" &&
      isUniversalSalvationTabletKey(itemType.key) &&
      !tabletPriceByYear.has(entry.year)
    ) {
      tabletPriceByYear.set(entry.year, await getUniversalSalvationTabletPrices(entry.year));
    }
  }

  // 先驗證與預算金額（交易外，快速失敗）。
  type Prepared = { entry: BatchItemEntry; itemType: (typeof itemTypes)[number]; householdId: string; quantity: number; amountDue: number };
  const prepared: Prepared[] = [];
  for (const entry of entries) {
    const itemType = itemTypeMap.get(entry.registrationItemTypeId);
    if (!itemType) return { ok: false, status: 404, error: "找不到報名項目設定" };
    const member = memberMap.get(entry.memberId);
    if (!member) return { ok: false, status: 404, error: "找不到報名成員" };
    const quantity = entry.quantity ?? itemType.defaultQuantity;

    let amountDue: number;
    if (
      itemType.activityType === "UNIVERSAL_SALVATION" &&
      isUniversalSalvationTabletKey(itemType.key)
    ) {
      // 四類牌位：應收 = 年度單價 × 數量（未設定單價 → 0，不寫死金額）。
      const prices = tabletPriceByYear.get(entry.year);
      const unit = prices ? tabletUnitPriceFor(itemType.key, prices) : null;
      if (!Number.isInteger(quantity) || quantity < 1) {
        return { ok: false, status: 400, error: `${itemType.name}：數量必須是 1 以上的整數` };
      }
      amountDue = unit !== null ? Math.round(unit * quantity * 100) / 100 : 0;
    } else {
      const amount = computeItemAmountDue({
        feeMode: itemType.feeMode as never,
        defaultUnitPrice: itemType.defaultUnitPrice === null ? null : Number(itemType.defaultUnitPrice),
        quantity,
        customAmount: entry.customAmount ?? null,
        feeChoice: entry.feeChoice ?? null,
      });
      if (!amount.ok) return { ok: false, status: 400, error: `${itemType.name}：${amount.reason}` };
      amountDue = amount.amountDue;
    }
    prepared.push({ entry, itemType, householdId: member.householdId, quantity, amountDue });
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

        // V14.2 冪等：同一 (RitualRecord, RegistrationItemType, 成員) 未取消未刪除的
        // 項目**一律不重複建立**（不再只擋 allowMultiplePerMember=false 的項目）——
        // 牌位的多筆內容是靠 UniversalSalvationEntry 表達，不是靠多列 RitualRegistrationItem，
        // 之前重新操作報名就會冒出兩筆「超拔祖先／累世冤親／本人」。
        //
        // 找到既有項目時：
        //   DRAFT 且未收款 → 依「最新年度單價 × 數量」重算（順便修正舊的 0 元草稿），
        //                    並更新數量；不新增第二筆。
        //   已確認／已收款  → 金額是建立當下快照，**不自動改價**，只回報已存在。
        const existing = await tx.ritualRegistrationItem.findFirst({
          where: {
            ritualRecordId: recordId,
            registrationItemTypeId: p.itemType.id,
            memberId: p.entry.memberId,
            deletedAt: null,
            status: { not: "CANCELLED" },
          },
          select: { id: true, status: true, amountPaid: true },
        });
        if (existing) {
          const editable = existing.status === "DRAFT" && Number(existing.amountPaid) === 0;
          if (editable) {
            await tx.ritualRegistrationItem.update({
              where: { id: existing.id },
              data: { quantity: p.quantity, amountDue: p.amountDue, amountUnpaid: p.amountDue },
            });
            await upsertParticipantsInTransaction(tx, recordId, [p.entry.memberId], operatorName ?? null);
            await linkItemToExistingDetail(tx, {
              registrationItemId: existing.id,
              contentKind: p.itemType.contentKind,
              feeMode: p.itemType.feeMode,
              activityType: p.itemType.activityType,
              ritualRecordId: recordId,
              itemAmountDue: p.amountDue,
              unitPrice: p.itemType.defaultUnitPrice === null ? null : Number(p.itemType.defaultUnitPrice),
              quantity: p.quantity,
              participantCount: 1,
              operatorName,
            });
          }
          outcomes.push({
            memberId: p.entry.memberId,
            registrationItemTypeId: p.itemType.id,
            outcome: "ALREADY_EXISTS",
            registrationItemId: existing.id,
            ritualRecordId: recordId,
            amountDue: editable ? p.amountDue : 0,
          });
          continue;
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
          feeMode: p.itemType.feeMode,
          activityType: p.itemType.activityType,
          ritualRecordId: recordId,
          itemAmountDue: p.amountDue,
          unitPrice: p.itemType.defaultUnitPrice === null ? null : Number(p.itemType.defaultUnitPrice),
          quantity: p.quantity,
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
  /** V14.2：類別（項目型別名稱，例如「累世冤親債主」）。 */
  categoryName: string;
  /**
   * V14.2：牌位／當事人名稱（列印、收款、補印、查詢的共同識別）。
   * 依序：自訂名稱 → 當事人（memberId 對應成員）姓名 → 類別名稱。
   * 例：累世冤親債主每位成員各一筆 → 顯示「周財寶」「陳秀珍」而非固定文字。
   */
  subjectName: string;
  /** V14.2：牌位地址（沿用既有 UniversalSalvationEntry.tabletAddress，同列印欄位）。 */
  tabletAddress: string | null;
  activityGroupName: string;
  memberId: string | null;
  quantity: number;
  customName: string | null;
  amountDue: number;
  amountPaid: number;
  amountUnpaid: number;
  status: string;
};

/** V14.2：itemKey → 對應的 UniversalSalvationEntry 類別（供解析牌位地址／名稱）。 */
const TABLET_ITEM_ENTRY_CATEGORY: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR" | "UNBORN_CHILD"> = {
  US_ANCESTOR: "ANCESTOR_LINE",
  US_ZHENGHUN: "INDIVIDUAL_SOUL",
  US_YUANQIN: "DEBT_CREDITOR",
  US_WUYUAN: "UNBORN_CHILD",
};

/**
 * 列出某筆 RitualRecord 底下的報名項目（未刪除）。
 *
 * V14.2 金額一致性：每個項目的「應收／已收／未收」一律**依項目型別讀取真正的
 * 收費來源**，不再直接信任 RitualRegistrationItem.amountDue。原因──連結型項目
 * （SPONSOR→UniversalSalvationDetail、LANTERN→LanternRegistration）為避免兩筆
 * 應收，本項金額在報名時被歸零，金額實際記在既有明細表；若直接顯示本項金額，
 * 普渡頁會顯示 0，而信眾資料頁（devotee360）讀的是明細表的真實金額，兩頁不一致。
 *
 * 這裡改成：
 *   contentKind === "SPONSOR" → 讀 UniversalSalvationDetail（本 RitualRecord 1:1）
 *   contentKind === "LANTERN" → 讀 LanternRegistration（本 RitualRecord 1:1）
 *   其餘（RICE/TABLE/ROSTER/POCKET/自訂捐款…自身即收款來源）→ 用本項自身金額
 * 兩張明細都以 ritualRecordId 唯一鍵一次撈回（各 1 筆，非 N+1），
 * 與 devotee360 相同來源，確保普渡頁與信眾資料頁金額完全一致。
 */
export async function listRegisteredItems(ritualRecordId: string): Promise<RegisteredItemView[]> {
  // V14.2：開啟草稿／載入清單時自動整理重複的乾淨草稿項目（冪等、只動 DRAFT
  // 未收款未列印者），讓既有測試重複資料在打開頁面時就收斂成單筆。
  await cleanupDuplicateDraftItems(ritualRecordId, null);

  const [rows, salvationDetail, lantern, salvationEntries] = await Promise.all([
    prisma.ritualRegistrationItem.findMany({
      where: { ritualRecordId, deletedAt: null },
      include: { registrationItemType: true, member: { select: { name: true } } },
      orderBy: [{ registrationItemType: { sortOrder: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.universalSalvationDetail.findUnique({
      where: { ritualRecordId },
      select: { amountDue: true, amountPaid: true, amountUnpaid: true },
    }),
    prisma.lanternRegistration.findUnique({
      where: { ritualRecordId },
      select: { amountDue: true, amountPaid: true, amountUnpaid: true },
    }),
    // V14.2：本 RitualRecord 的普渡牌位明細（沿用既有 UniversalSalvationEntry），
    // 供解析牌位地址與名稱——不建第二套資料。
    prisma.universalSalvationEntry.findMany({
      where: { deletedAt: null, universalSalvation: { ritualRecordId } },
      select: { category: true, displayName: true, tabletAddress: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  // 依類別彙整既有牌位明細：以名稱（trim）對地址；並記每類是否僅一筆（可安全帶入）。
  const addrByCategoryName = new Map<string, string | null>();
  const countByCategory = new Map<string, number>();
  const soleByCategory = new Map<string, { displayName: string; tabletAddress: string | null }>();
  for (const e of salvationEntries) {
    addrByCategoryName.set(`${e.category}::${e.displayName.trim()}`, e.tabletAddress ?? null);
    countByCategory.set(e.category, (countByCategory.get(e.category) ?? 0) + 1);
    soleByCategory.set(e.category, { displayName: e.displayName, tabletAddress: e.tabletAddress ?? null });
  }

  return rows.map((r) => {
    const kind = r.registrationItemType.contentKind;
    // 預設用本項自身金額（無既有收款來源的型態）。
    let amountDue = Number(r.amountDue);
    let amountPaid = Number(r.amountPaid);
    let amountUnpaid = Number(r.amountUnpaid);
    if (kind === "SPONSOR" && salvationDetail) {
      amountDue = Number(salvationDetail.amountDue);
      amountPaid = Number(salvationDetail.amountPaid);
      amountUnpaid = Number(salvationDetail.amountUnpaid);
    } else if (kind === "LANTERN" && lantern) {
      amountDue = Number(lantern.amountDue);
      amountPaid = Number(lantern.amountPaid);
      amountUnpaid = Number(lantern.amountUnpaid);
    }

    const memberName = r.member?.name ?? null;
    // 名稱（共同識別）：自訂名稱 → 當事人姓名 → 類別名稱。
    const subjectName = r.customName ?? memberName ?? r.registrationItemType.name;

    // 牌位地址：沿用既有 UniversalSalvationEntry。先以「類別＋名稱」精準對，
    // 對不到時若該類別在本筆報名只有一筆牌位，帶入那一筆的地址（安全不誤帶）。
    const entryCategory = TABLET_ITEM_ENTRY_CATEGORY[r.registrationItemType.key];
    let tabletAddress: string | null = null;
    if (entryCategory) {
      const exact = addrByCategoryName.get(`${entryCategory}::${subjectName.trim()}`);
      if (exact !== undefined) {
        tabletAddress = exact;
      } else if ((countByCategory.get(entryCategory) ?? 0) === 1) {
        tabletAddress = soleByCategory.get(entryCategory)?.tabletAddress ?? null;
      }
    }

    return {
      id: r.id,
      registrationItemTypeId: r.registrationItemTypeId,
      itemKey: r.registrationItemType.key,
      itemName: r.customName ?? r.registrationItemType.name,
      categoryName: r.registrationItemType.name,
      subjectName,
      tabletAddress,
      activityGroupName: r.registrationItemType.activityGroupName,
      memberId: r.memberId,
      quantity: r.quantity,
      customName: r.customName,
      amountDue,
      amountPaid,
      amountUnpaid,
      status: r.status,
    };
  });
}

/**
 * 取消一個報名項目（不硬刪，保留歷史）。
 *
 * V14.2：
 *   - 狀態改 CANCELLED、amountUnpaid 歸 0（自待收款／總額排除）；同時設 deletedAt
 *     讓所有以 deletedAt IS NULL 過濾的既有查詢（報名頁清單、列印名冊）都不再顯示，
 *     但資料列仍在（非硬刪）。收款 adapter 也已排除 status=CANCELLED / deletedAt。
 *   - 已收款、已開收據（有收款即有收據）、已列印的項目**不得直接取消**，回明確原因。
 *   - 連結型（SPONSOR→UniversalSalvationDetail、LANTERN→LanternRegistration）：金額
 *     記在既有明細、本項一律 0，取消本項不會造成重複應收；明細本身的取消走其既有流程。
 *   - 冪等：已取消再呼叫直接回成功。
 */
export async function removeRegisteredItem(
  registrationItemId: string,
  operatorName?: string | null
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const item = await prisma.ritualRegistrationItem.findUnique({
    where: { id: registrationItemId },
    select: { id: true, deletedAt: true, status: true, amountPaid: true, printCount: true, printedAt: true },
  });
  if (!item) return { ok: false, status: 404, error: "找不到這個報名項目" };
  if (item.deletedAt || item.status === "CANCELLED") return { ok: true }; // 冪等
  if (Number(item.amountPaid) > 0) {
    return { ok: false, status: 409, error: "此項目已有收款／收據，請先於收款中心處理退款後再取消" };
  }
  if (item.printCount > 0 || item.printedAt) {
    return { ok: false, status: 409, error: "此項目已列印，不得直接取消；如需作廢請依既有補印／作廢流程處理" };
  }
  await prisma.ritualRegistrationItem.update({
    where: { id: registrationItemId },
    data: {
      status: "CANCELLED",
      amountUnpaid: 0,
      deletedAt: new Date(),
      deletedByName: operatorName ?? null,
    },
  });
  return { ok: true };
}

/**
 * V14.2：草稿重複項目整理（安全、冪等）。
 *
 * 限定同一 RitualRecord 內、同一 (RegistrationItemType, 成員) 的**重複**項目，且每一筆都：
 *   - status = DRAFT
 *   - 未收款（amountPaid = 0，等於也沒有收據）
 *   - 未列印（printCount = 0 且 printedAt = null）
 * 才納入整理。保留「資料較完整」的一筆（金額高者優先，其次有自訂名稱，其次最早建立），
 * 其餘改成 CANCELLED（不硬刪），同時 amountUnpaid=0、deletedAt=now（自清單與名冊隱藏）。
 *
 * 絕不動到已確認／已收款／已列印的資料。可重複執行（跑第二次不會再有可整理的重複）。
 * 回傳被取消的筆數。
 */
export async function cleanupDuplicateDraftItems(
  ritualRecordId: string,
  operatorName?: string | null
): Promise<{ cancelled: number }> {
  const rows = await prisma.ritualRegistrationItem.findMany({
    where: { ritualRecordId, deletedAt: null, status: "DRAFT" },
    select: {
      id: true,
      registrationItemTypeId: true,
      memberId: true,
      amountDue: true,
      amountPaid: true,
      customName: true,
      printCount: true,
      printedAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  // 只收「乾淨可整理」的列（未收款、未列印）。有收款/列印的一律不碰。
  const eligible = rows.filter(
    (r) => Number(r.amountPaid) === 0 && r.printCount === 0 && !r.printedAt
  );

  // 依 (itemType, member) 分組。
  const groups = new Map<string, typeof eligible>();
  for (const r of eligible) {
    const key = `${r.registrationItemTypeId}::${r.memberId ?? ""}`;
    const g = groups.get(key);
    if (g) g.push(r);
    else groups.set(key, [r]);
  }

  const toCancel: string[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue; // 沒有重複
    // 保留「較完整」的一筆：金額高 → 有自訂名稱 → 最早建立。
    const keep = [...g].sort((a, b) => {
      const amt = Number(b.amountDue) - Number(a.amountDue);
      if (amt !== 0) return amt;
      const named = (b.customName ? 1 : 0) - (a.customName ? 1 : 0);
      if (named !== 0) return named;
      return a.createdAt.getTime() - b.createdAt.getTime();
    })[0];
    for (const r of g) if (r.id !== keep.id) toCancel.push(r.id);
  }

  if (toCancel.length === 0) return { cancelled: 0 };

  await prisma.ritualRegistrationItem.updateMany({
    where: { id: { in: toCancel } },
    data: {
      status: "CANCELLED",
      amountUnpaid: 0,
      deletedAt: new Date(),
      deletedByName: operatorName ?? "系統：草稿重複整理",
    },
  });
  return { cancelled: toCancel.length };
}
