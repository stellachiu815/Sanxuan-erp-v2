import { prisma } from "@/lib/prisma";
import type { Prisma, ActivityType, RitualRecordStatus } from "@prisma/client";
import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
import { upsertLanternRegistrationInTransaction } from "@/lib/lanternRegistration";
import {
  getRegistrationItemTypeById,
  computeItemAmountDue,
} from "@/lib/registrationItems";
import {
  getUniversalSalvationTabletPrices,
  getUniversalSalvationSponsorPrice,
  isUniversalSalvationTabletKey,
  tabletUnitPriceFor,
  type TabletUnitPrices,
} from "@/lib/universalSalvationTabletPricing";
import { resolveYangshangNames } from "@/lib/yangshang";
import { ensureTabletPrintObjects } from "@/lib/additionalPrintItems";
import { createPurificationEntryForRecordInTx } from "@/lib/purification";
import { displayDebtCreditorName } from "@/lib/debtCreditorName";
import {
  getAnnualLanternPrices,
  isAnnualLanternPricedItemKey,
  annualLanternItemUnitPrice,
  type AnnualLanternPrices,
} from "@/lib/annualLanternPricing";
import { assertFamilyLanternInclusion, writeFamilyLanternSnapshotInTx, FamilyLanternError } from "@/lib/familyLantern";
import {
  listHouseholdAncestorOptions,
  listHouseholdIndividualSoulOptions,
  listHouseholdYangshangCandidates,
  type WorshipOption,
} from "@/lib/householdRegistrationOptions";

/**
 * V15R5 正式規格：普渡「命名牌位」三類——建立報名當下即建立 linked Draft（帶入既有資料），
 * 不建獨立 placeholder、不顯示「牌位資料待確認」。冤親（US_YUANQIN）以成員為主另走既有流程。
 */
const AUTO_DRAFT_TABLET_KEYS = new Set(["US_ANCESTOR", "US_ZHENGHUN", "US_WUYUAN"]);
const AUTO_DRAFT_ITEM_KEY_TO_CATEGORY: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "UNBORN_CHILD"> = {
  US_ANCESTOR: "ANCESTOR_LINE",
  US_ZHENGHUN: "INDIVIDUAL_SOUL",
  US_WUYUAN: "UNBORN_CHILD",
};

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
    // V15R5：年度燈統一後，光明/太歲/全家燈同掛一筆 ANNUAL_LANTERN RitualRecord，
    // 無法共用單一 LanternRegistration（@@unique ritualRecordId，會互相覆蓋金額）。
    // 因此改為**項目自身計價**（RitualRegistrationItem.amountDue），由既有的
    // registrationItem 收款 adapter 進收款中心（與贊普／龍鳳燈同一套 self-costed 機制）。
    // 不歸零、不路由 LanternRegistration → 每筆項目各自一份應收，無雙重應收。
    // 舊的 per-type 年度燈事件（GUANGMING/TAISUI/FAMILY_LANTERN）維持既有 LanternRegistration 金流。
    if (params.activityType === "ANNUAL_LANTERN") return;
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

  // V15R2：贊普／隨喜贊普（SPONSOR）改為**各自獨立、自身計價**的 RitualRegistrationItem
  // （item.amountDue = quantity × unitPrice），不再把金額塞回 UniversalSalvationDetail
  // 共用單一贊普欄、不再歸零本項。收款由 receivableAdapters 的 US_SPONSOR/
  // US_SPONSOR_DONATION item adapter 各自計價；因此這裡 SPONSOR 不做特別連結，
  // 直接落到下方「其餘型態：本項自身即為收款來源」。
  // 其餘型態：本項目自身即為索引（RICE/TABLE/ROSTER/龍鳳燈／贊普由自身 adapter 收款；
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
  /**
   * V15R4：全家燈以家戶為一筆，但需記錄要列印的家戶成員（6～13 位）。這些成員
   * 於同一 tx 一併寫入 RitualParticipant（沿用既有參加者機制，不建第二套）。
   * 其他項目不帶此欄位；帶入時與 entry.memberId 併集去重。
   */
  participantMemberIds?: string[] | null;
};

/** 這一筆項目要寫入的參加者：entry.memberId ＋（全家燈才有的）participantMemberIds，去重。 */
function participantIdsFor(entry: BatchItemEntry): string[] {
  return [...new Set([entry.memberId, ...(entry.participantMemberIds ?? [])].filter((id) => !!id))];
}

/**
 * V15R5 沿用去年：讀取某家戶「上一個有年度燈報名的年度」的**報名內容**（不含付款）。
 * 只回傳可沿用的內容（每位成員勾了哪些燈、是否有全家燈），供 picker 預先勾選；
 * 送出時走同一支 registerItemsBatch（以**新年度**重新計算單價、DRAFT、不帶 amountPaid／
 * 收據／列印狀態／CONFIRMED），不建立第二套報名系統。
 */
export type AnnualLanternCarryOver = {
  fromYear: number | null;
  perMember: { memberId: string; itemKeys: string[] }[];
  hadFamily: boolean;
};

/**
 * V15R5 通用「沿用去年」：把某家戶上一個年度的**某活動類型**報名內容 carry-over 到新年度。
 *
 * 走同一套既有機制（registerItemsBatch＋普渡 createUniversalSalvationEntry），不建第二套：
 *  - item-based（年度燈/宮慶/補庫…）：讀去年 RitualRegistrationItem（項目型別/數量/成員/自訂名），
 *    以**新年度**送 registerItemsBatch → 依新年度單價重算、DRAFT、不帶付款/收據/列印。
 *  - 普渡：另呼叫 carryOverUniversalSalvationEntries（每筆牌位含自己的 tabletAddress）。
 * 一律不複製 amountPaid／收據／交易／printedAt／printCount／CONFIRMED／已完成狀態。
 */
export async function carryOverHouseholdRegistration(
  householdId: string,
  activityType: ActivityType,
  toYear: number,
  operatorName?: string | null
): Promise<{ ok: true; fromYear: number | null; itemsCreated: number } | { ok: false; status: number; error: string }> {
  const prev = await prisma.ritualRecord.findFirst({
    where: { householdId, activityType, year: { lt: toYear }, deletedAt: null },
    orderBy: { year: "desc" },
    select: { year: true },
  });
  if (!prev) return { ok: true, fromYear: null, itemsCreated: 0 };

  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      ritualRecord: { householdId, activityType, year: prev.year, deletedAt: null },
      deletedAt: null,
      status: { not: "CANCELLED" },
      memberId: { not: null },
    },
    select: { memberId: true, quantity: true, customName: true, registrationItemTypeId: true },
  });
  const entries: BatchItemEntry[] = items.map((it) => ({
    memberId: it.memberId as string,
    registrationItemTypeId: it.registrationItemTypeId,
    year: toYear,
    quantity: it.quantity,
    customName: it.customName,
  }));
  if (entries.length > 0) {
    const res = await registerItemsBatch(entries, operatorName);
    if (!res.ok) return res;
  }
  return { ok: true, fromYear: prev.year, itemsCreated: entries.length };
}

export async function getHouseholdAnnualLanternLastYear(
  householdId: string,
  targetYear: number
): Promise<AnnualLanternCarryOver> {
  const rec = await prisma.ritualRecord.findFirst({
    where: { householdId, activityType: "ANNUAL_LANTERN", year: { lt: targetYear }, deletedAt: null },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });
  if (!rec) return { fromYear: null, perMember: [], hadFamily: false };
  const items = await prisma.ritualRegistrationItem.findMany({
    where: {
      ritualRecordId: rec.id,
      deletedAt: null,
      status: { not: "CANCELLED" },
      registrationItemType: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_PURIFICATION", "LANTERN_FAMILY"] } },
    },
    select: { memberId: true, registrationItemType: { select: { key: true } } },
  });
  const byMember = new Map<string, Set<string>>();
  let hadFamily = false;
  for (const it of items) {
    const key = it.registrationItemType.key;
    if (key === "LANTERN_FAMILY") {
      hadFamily = true;
      continue;
    }
    if (!it.memberId) continue;
    const set = byMember.get(it.memberId) ?? new Set<string>();
    set.add(key);
    byMember.set(it.memberId, set);
  }
  return {
    fromYear: rec.year,
    perMember: [...byMember.entries()].map(([memberId, keys]) => ({ memberId, itemKeys: [...keys] })),
    hadFamily,
  };
}

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
  operatorName?: string | null,
  operatorUserId?: string | null
): Promise<BatchResult> {
  if (entries.length === 0) return { ok: false, status: 400, error: "沒有要報名的項目" };

  // 先把所有項目設定與成員家戶一次撈齊（避免交易內 N+1）。
  const itemTypeIds = Array.from(new Set(entries.map((e) => e.registrationItemTypeId)));
  const memberIds = Array.from(new Set(entries.map((e) => e.memberId)));
  const [itemTypes, members] = await Promise.all([
    prisma.registrationItemType.findMany({ where: { id: { in: itemTypeIds } } }),
    prisma.member.findMany({ where: { id: { in: memberIds }, deletedAt: null }, select: { id: true, householdId: true, name: true } }),
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

  // V15R5：年度燈「祭改／全家燈」的年度單價與祭改所屬 ANNUAL_LANTERN 事件——**交易外**一次撈齊
  // （避免在互動式交易內逐項查詢造成 5000ms timeout → rollback → 資料未建立）。
  const annualPriceByYear = new Map<number, AnnualLanternPrices>();
  const annualEventIdByYear = new Map<number, string | null>();
  for (const entry of entries) {
    const itemType = itemTypeMap.get(entry.registrationItemTypeId);
    if (!itemType) continue;
    // V15R5.1：光明燈/太歲燈/全家燈皆自身計價、依年度燈四項目單價；祭改另走 PurificationEntry。
    const needsAnnual = isAnnualLanternPricedItemKey(itemType.key) || itemType.contentKind === "PURIFICATION";
    if (needsAnnual && !annualPriceByYear.has(entry.year)) {
      annualPriceByYear.set(entry.year, await getAnnualLanternPrices(entry.year));
      const ev = await prisma.templeEvent.findUnique({
        where: { activityType_year: { activityType: "ANNUAL_LANTERN", year: entry.year } },
        select: { id: true },
      });
      annualEventIdByYear.set(entry.year, ev?.id ?? null);
    }
  }

  // V15R5 正式規格：命名牌位（歷代祖先／乙位正魂／無緣子女）在「建立報名」當下就要建立
  // **完整或部分完整的 linked Draft**——直接帶入本戶既有牌位姓名、地址與陽上人，
  // 讓使用者進畫面即看到既有內容可修改，**不留 0 元 placeholder、不顯示「牌位資料待確認」**。
  // 本戶既有選項於交易外一次預取（穩定排序：worship_records 優先、同名合併、createdAt 由舊到新），
  // 交易內只做建立，降低互動式交易查詢數。
  const tabletDraftByHousehold = new Map<
    string,
    { ancestors: WorshipOption[]; individualSouls: WorshipOption[]; yangshang: string[]; address: string | null }
  >();
  for (const entry of entries) {
    const itemType = itemTypeMap.get(entry.registrationItemTypeId);
    if (!itemType || !AUTO_DRAFT_TABLET_KEYS.has(itemType.key)) continue;
    const hhId = memberMap.get(entry.memberId)?.householdId;
    if (!hhId || tabletDraftByHousehold.has(hhId)) continue;
    const [ancestors, individualSouls, yangshang, hh] = await Promise.all([
      listHouseholdAncestorOptions(hhId),
      listHouseholdIndividualSoulOptions(hhId),
      listHouseholdYangshangCandidates(hhId),
      prisma.household.findUnique({ where: { id: hhId }, select: { address: true } }),
    ]);
    tabletDraftByHousehold.set(hhId, { ancestors, individualSouls, yangshang, address: hh?.address ?? null });
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
    } else if (isAnnualLanternPricedItemKey(itemType.key)) {
      // V15R5.1：光明燈/太歲燈/全家燈＝依「該年度活動」單價（brightLight/taisui/familyLantern），
      // **不再讀全域 defaultUnitPrice、不寫死 500**；未設定 → 0（不擋報名、可存草稿）。
      // 全家燈整戶一筆固定價（qty=1）；光明/太歲依份數計價。前端傳入的金額一律不採信。
      const prices = annualPriceByYear.get(entry.year);
      const unit = prices ? annualLanternItemUnitPrice(itemType.key, prices) : null;
      const qty = itemType.key === "LANTERN_FAMILY" ? 1 : quantity;
      if (!Number.isInteger(qty) || qty < 1) {
        return { ok: false, status: 400, error: `${itemType.name}：數量必須是 1 以上的整數` };
      }
      amountDue = unit != null && unit > 0 ? Math.round(unit * qty * 100) / 100 : 0;
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

        // ── V15R5.3 全家燈：以家戶一筆、依 (RitualRecord, LANTERN_FAMILY) 防重（**不以第一位成員區分**）──
        // 建立/更新全家燈 item（年度單價自身計價）＋於同一交易寫「年度不可變快照」
        //（FamilyLanternRegistration＋FamilyLanternMember：伺服器重查合格成員、地址、戶主，不信任前端）。
        // 已存在→更新同一筆、不建第二筆；至少一位合格成員否則整筆 rollback。只影響全家燈。
        if (p.itemType.key === "LANTERN_FAMILY") {
          // ⚠️ 先驗證納入名單合法性（在建立**任何** item / 快照之前）。無效即 throw
          // FamilyLanternError → 整筆交易 rollback（Prisma 只在 throw 時回滾；return 會 commit），
          // 不會殘留 RitualRegistrationItem / FamilyLanternRegistration / FamilyLanternMember。
          const familyResolved = await assertFamilyLanternInclusion(tx, {
            householdId: p.householdId,
            includedMemberIds: p.entry.participantMemberIds ?? [p.entry.memberId],
          });
          const prices = annualPriceByYear.get(p.entry.year);
          const unit = prices ? annualLanternItemUnitPrice("LANTERN_FAMILY", prices) : null;
          const amount = unit != null && unit > 0 ? Math.round(unit * 100) / 100 : 0;
          const existingFam = await tx.ritualRegistrationItem.findFirst({
            where: { ritualRecordId: recordId, registrationItemTypeId: p.itemType.id, deletedAt: null, status: { not: "CANCELLED" } },
            select: { id: true, amountPaid: true },
          });
          let famItemId: string;
          let famOutcome: "CREATED" | "ALREADY_EXISTS";
          if (existingFam) {
            // 未收款才依當年度單價重算（已收款保留快照，不動金額）。
            if (Number(existingFam.amountPaid) === 0) {
              await tx.ritualRegistrationItem.update({
                where: { id: existingFam.id },
                data: { quantity: 1, memberId: p.entry.memberId, lockedUnitPrice: unit, amountDue: amount, amountUnpaid: amount, status: "DRAFT" },
              });
            }
            famItemId = existingFam.id;
            famOutcome = "ALREADY_EXISTS";
          } else {
            const created = await tx.ritualRegistrationItem.create({
              data: {
                ritualRecordId: recordId,
                registrationItemTypeId: p.itemType.id,
                memberId: p.entry.memberId,
                quantity: 1,
                lockedUnitPrice: unit,
                amountDue: amount,
                amountPaid: 0,
                amountUnpaid: amount,
                status: "DRAFT",
              },
              select: { id: true },
            });
            famItemId = created.id;
            famOutcome = "CREATED";
          }
          await upsertParticipantsInTransaction(tx, recordId, participantIdsFor(p.entry), operatorName ?? null);
          // 已驗證 → 寫年度快照（此步不再驗證，用 familyResolved 的伺服器端資料）。
          await writeFamilyLanternSnapshotInTx(tx, {
            ritualRegistrationItemId: famItemId,
            ritualRecordId: recordId,
            householdId: p.householdId,
            year: p.entry.year,
            resolved: familyResolved,
            operatorUserId,
            operatorName,
          });
          outcomes.push({
            memberId: p.entry.memberId,
            registrationItemTypeId: p.itemType.id,
            outcome: famOutcome,
            registrationItemId: famItemId,
            ritualRecordId: recordId,
            amountDue: amount,
          });
          continue;
        }

        // ── V15R5 正式規格：命名牌位（祖先／乙位正魂／無緣）建立報名即建立 linked Draft ──
        // 直接建立 1 筆 UniversalSalvationEntry（帶入本戶既有牌位姓名／地址／陽上人）＋
        // 由 createUniversalSalvationEntry 內的 ensureLinkedTabletItem 連動 1 筆 linked
        // RitualRegistrationItem（年度單價＝唯一價格來源 getUniversalSalvationTabletPrices，
        // 不重複計算）。兩者 1:1，無獨立 placeholder、不顯示「牌位資料待確認」。
        // 冪等：本 record 已有同類 entry（重送／重新進入編輯器）→ 不重建、不增筆。
        if (AUTO_DRAFT_TABLET_KEYS.has(p.itemType.key)) {
          const category = AUTO_DRAFT_ITEM_KEY_TO_CATEGORY[p.itemType.key];
          const existingEntry = await tx.universalSalvationEntry.findFirst({
            where: { category, deletedAt: null, universalSalvation: { ritualRecordId: recordId } },
            select: { registrationItem: { select: { id: true } } },
          });
          if (existingEntry) {
            outcomes.push({
              memberId: p.entry.memberId,
              registrationItemTypeId: p.itemType.id,
              outcome: "ALREADY_EXISTS",
              registrationItemId: existingEntry.registrationItem?.id ?? null,
              ritualRecordId: recordId,
              amountDue: 0,
            });
            continue;
          }
          // 確保普渡明細存在（與冤親流程一致；createUniversalSalvationEntry 需要它）。
          await tx.universalSalvationDetail.upsert({
            where: { ritualRecordId: recordId },
            create: { ritualRecordId: recordId, isRegistered: true },
            update: {},
          });
          const prep = tabletDraftByHousehold.get(p.householdId);
          const primary =
            category === "ANCESTOR_LINE"
              ? prep?.ancestors[0]
              : category === "INDIVIDUAL_SOUL"
                ? prep?.individualSouls[0]
                : undefined;
          // 陽上人：既有牌位有就沿用，否則預設帶入家戶成員/固定陽上人。地址：既有牌位地址→家戶地址。
          const yangshangNames =
            primary?.yangshangNames && primary.yangshangNames.length > 0 ? primary.yangshangNames : prep?.yangshang ?? [];
          const tabletAddress = primary?.tabletAddress ?? prep?.address ?? null;
          // 迴避 ritual.ts ↔ registrationItemRegistration.ts 靜態循環：以動態載入取用建立函式，
          // 沿用**同一套** createUniversalSalvationEntry（不建第二套建立邏輯）；傳入本交易 tx。
          const { createUniversalSalvationEntry } = await import("@/lib/ritual");
          const res = await createUniversalSalvationEntry(
            p.householdId,
            p.entry.year,
            {
              category,
              displayName: primary?.displayName ?? "",
              yangshangNames,
              tabletAddress,
              linkedItemMemberId: p.entry.memberId,
            },
            operatorName,
            tx
          );
          if (!res.ok) return { ok: false as const, status: res.status, error: res.error };
          await upsertParticipantsInTransaction(tx, recordId, participantIdsFor(p.entry), operatorName ?? null);
          const createdItem = await tx.ritualRegistrationItem.findFirst({
            where: {
              ritualRecordId: recordId,
              registrationItemTypeId: p.itemType.id,
              deletedAt: null,
              universalSalvationEntry: { category },
            },
            orderBy: { createdAt: "desc" },
            select: { id: true, amountDue: true },
          });
          outcomes.push({
            memberId: p.entry.memberId,
            registrationItemTypeId: p.itemType.id,
            outcome: "CREATED",
            registrationItemId: createdItem?.id ?? null,
            ritualRecordId: recordId,
            amountDue: createdItem ? Number(createdItem.amountDue) : 0,
          });
          continue;
        }

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
          select: { id: true, status: true, amountPaid: true, quantity: true, lockedUnitPrice: true },
        });
        if (existing) {
          const editable = existing.status === "DRAFT" && Number(existing.amountPaid) === 0;
          if (editable) {
            // V15R3（P0-2）：再次新增相同項目時的行為——
            //   一般贊普（US_SPONSOR）：份數**累加**（existing.quantity + 本次），沿用既有
            //     lockedUnitPrice 快照重算金額（不重新讀新年度價覆蓋快照）。
            //   隨喜贊普（US_SPONSOR_DONATION）：自由金額，**同筆更新**為本次金額（不累加、不套固定價）。
            //   其他項目：沿用原本「以本次數量／金額取代」行為（牌位多筆內容靠 entry 表達）。
            let newQty = p.quantity;
            let newAmount = p.amountDue;
            let newLocked = existing.lockedUnitPrice != null ? Number(existing.lockedUnitPrice) : null;
            if (p.itemType.key === "US_SPONSOR") {
              newQty = existing.quantity + p.quantity;
              const unit = existing.lockedUnitPrice != null
                ? Number(existing.lockedUnitPrice)
                : await getUniversalSalvationSponsorPrice(p.entry.year, tx);
              if (unit == null || !Number.isFinite(unit)) {
                return { ok: false as const, status: 409, error: "尚未設定本年度贊普固定單價，請先於活動設定頁設定後再報名" };
              }
              newLocked = unit;
              newAmount = Math.round(newQty * unit);
            } else if (p.itemType.key === "US_SPONSOR_DONATION") {
              newQty = 1;
              newAmount = p.amountDue; // 本次自由金額
              newLocked = p.amountDue;
            }
            await tx.ritualRegistrationItem.update({
              where: { id: existing.id },
              data: { quantity: newQty, lockedUnitPrice: newLocked, amountDue: newAmount, amountUnpaid: newAmount },
            });
            await upsertParticipantsInTransaction(tx, recordId, participantIdsFor(p.entry), operatorName ?? null);
            await linkItemToExistingDetail(tx, {
              registrationItemId: existing.id,
              contentKind: p.itemType.contentKind,
              feeMode: p.itemType.feeMode,
              activityType: p.itemType.activityType,
              ritualRecordId: recordId,
              itemAmountDue: newAmount,
              unitPrice: p.itemType.defaultUnitPrice === null ? null : Number(p.itemType.defaultUnitPrice),
              quantity: newQty,
              participantCount: 1,
              operatorName,
            });
            outcomes.push({
              memberId: p.entry.memberId,
              registrationItemTypeId: p.itemType.id,
              outcome: "ALREADY_EXISTS",
              registrationItemId: existing.id,
              ritualRecordId: recordId,
              amountDue: newAmount,
            });
            continue;
          }
          // 已確認／已收款：不自動改動（保護收款快照）。
          outcomes.push({
            memberId: p.entry.memberId,
            registrationItemTypeId: p.itemType.id,
            outcome: "ALREADY_EXISTS",
            registrationItemId: existing.id,
            ritualRecordId: recordId,
            amountDue: 0,
          });
          continue;
        }

        // V15R3（P0-2）：首次建立贊普／隨喜贊普的計價——US_SPONSOR 用年度固定價、
        // 存 lockedUnitPrice 快照；US_SPONSOR_DONATION 用自由金額（customAmount）、quantity=1。
        let createQty = p.quantity;
        let createAmount = p.amountDue;
        let createLocked: number | null = null;
        if (p.itemType.key === "US_SPONSOR") {
          const unit = await getUniversalSalvationSponsorPrice(p.entry.year, tx);
          if (unit == null || !Number.isFinite(unit)) {
            return { ok: false as const, status: 409, error: "尚未設定本年度贊普固定單價，請先於活動設定頁設定後再報名" };
          }
          createLocked = unit;
          createAmount = Math.round(createQty * unit);
        } else if (p.itemType.key === "US_SPONSOR_DONATION") {
          createQty = 1;
          createLocked = p.amountDue;
          createAmount = p.amountDue;
        } else if (isAnnualLanternPricedItemKey(p.itemType.key)) {
          // V15R5.1：光明燈/太歲燈/全家燈＝依該年度活動單價（brightLight/taisui/familyLantern，
          // 交易外已預取），項目自身計價，**不讀 defaultUnitPrice、不寫死 500**；未設定 → 0
          //（不擋報名、可存草稿）。全家燈整戶一筆固定價（qty=1）；光明/太歲依份數。
          // lockedUnitPrice 存當下年度單價快照，日後改價不回頭改既有 DRAFT。
          const prices = annualPriceByYear.get(p.entry.year);
          const unit = prices ? annualLanternItemUnitPrice(p.itemType.key, prices) : null;
          createQty = p.itemType.key === "LANTERN_FAMILY" ? 1 : createQty;
          createLocked = unit;
          createAmount = unit != null && unit > 0 ? Math.round(unit * createQty * 100) / 100 : 0;
        }
        // 註：歷代祖先／乙位正魂／無緣子女不會走到這裡——它們在迴圈上方
        // 「建立報名即建立 linked Draft」分支已建立並連結完成（不留獨立 placeholder）。

        const created = await tx.ritualRegistrationItem.create({
          data: {
            ritualRecordId: recordId,
            registrationItemTypeId: p.itemType.id,
            memberId: p.entry.memberId,
            quantity: createQty,
            customName: p.entry.customName ?? null,
            lockedUnitPrice: createLocked,
            amountDue: createAmount,
            amountPaid: 0,
            amountUnpaid: createAmount,
            feeChoice: p.entry.feeChoice ?? null,
            status: "DRAFT",
          },
          select: { id: true },
        });

        await upsertParticipantsInTransaction(tx, recordId, participantIdsFor(p.entry), operatorName ?? null);

        await linkItemToExistingDetail(tx, {
          registrationItemId: created.id,
          contentKind: p.itemType.contentKind,
          feeMode: p.itemType.feeMode,
          activityType: p.itemType.activityType,
          ritualRecordId: recordId,
          itemAmountDue: createAmount,
          unitPrice: p.itemType.defaultUnitPrice === null ? null : Number(p.itemType.defaultUnitPrice),
          quantity: createQty,
          participantCount: 1,
          operatorName,
        });

        // V14.2：累世冤親債主（全戶加入）——為每位成員各建一筆 DEBT_CREDITOR 牌位並
        // **正式連結**（universalSalvationEntryId），displayName = 當事人姓名。之後名稱／
        // 陽上／地址／列印／補印／收款／查詢一律讀這一筆 entry，不依賴建立順序。
        if (p.itemType.key === "US_YUANQIN") {
          const detail = await tx.universalSalvationDetail.upsert({
            where: { ritualRecordId: recordId },
            create: { ritualRecordId: recordId, isRegistered: true },
            update: {},
            select: { id: true },
          });
          const memberName = memberMap.get(p.entry.memberId)?.name ?? null;
          const entry = await tx.universalSalvationEntry.create({
            data: {
              universalSalvationId: detail.id,
              category: "DEBT_CREDITOR",
              displayName: (p.entry.customName?.trim() || memberName) ?? p.itemType.name,
              sortOrder: 0,
            },
            select: { id: true },
          });
          await tx.ritualRegistrationItem.update({
            where: { id: created.id },
            data: { universalSalvationEntryId: entry.id },
          });
          // V14.4 Part 2：全戶冤親牌位建立時，共用 ensureTabletPrintObjects
          // 自動建立 TABLET＋預設 POCKET（同一 tx；不各自手寫）。
          await ensureTabletPrintObjects(
            {
              ritualRecordId: recordId,
              householdId: p.householdId,
              sourceEntryId: entry.id,
              printName: (p.entry.customName?.trim() || memberName) ?? p.itemType.name,
              memberId: p.entry.memberId,
              activityId: null,
            },
            tx
          );
        }

        // V15R4 年度燈統一（正式規格）：祭改內容型態（LANTERN_PURIFICATION，contentKind=PURIFICATION）
        // 在同一 tx 建立 PurificationEntry，掛在**同一個年度燈 RitualRecord**（activityType=ANNUAL_LANTERN）
        // 底下，使祭改立即進入祭改年度清單與小人頭貼紙列印中心（沿用既有編號規則與列印架構，不建第二套）。
        // 祭改事件＝這筆報名所屬的年度燈 TempleEvent（與光明燈／太歲燈同一個事件）。
        if (p.itemType.contentKind === "PURIFICATION") {
          // 年度燈事件 id 與祭改單價已於**交易外**預取（annualEventIdByYear／annualPriceByYear），
          // 交易內不再查詢，降低互動式交易的查詢數與 timeout 風險。
          const annualEventId = annualEventIdByYear.get(p.entry.year) ?? null;
          if (!annualEventId) {
            return { ok: false as const, status: 409, error: "尚未建立本年度「年度燈」活動，無法建立祭改報名" };
          }
          const pur = await createPurificationEntryForRecordInTx(
            tx,
            {
              purificationTempleEventId: annualEventId,
              ritualRecordId: recordId,
              memberId: p.entry.memberId,
              purificationUnitPrice: annualPriceByYear.get(p.entry.year)?.purificationUnitPrice ?? null,
            },
            operatorName
          );
          if (!pur.ok) return { ok: false as const, status: pur.status, error: pur.error };
        }

        outcomes.push({
          memberId: p.entry.memberId,
          registrationItemTypeId: p.itemType.id,
          outcome: "CREATED",
          registrationItemId: created.id,
          ritualRecordId: recordId,
          // 實際寫入 DB 的金額（命名牌位佔位為 0，連結後才帶入年度單價）。
          amountDue: createAmount,
        });
      }

      return { ok: true as const, outcomes, ritualRecordIds: Array.from(recordIds) };
    },
    // V15R5：整批報名（多人多項目＋祭改 PurificationEntry）在單一互動式交易內完成；
    // 預設 5000ms 對多筆祭改/全戶報名可能不足而 rollback（資料未建立）。已把年度單價與
    // 祭改事件預取到交易外、降低查詢數；此處再給合理上限（20s），不是無限拉長。
    { timeout: 20000, maxWait: 15000 });
  } catch (e) {
    // 全家燈資格驗證失敗（交易內 throw → 已 rollback）：回傳其原始狀態碼與訊息。
    if (e instanceof FamilyLanternError) return { ok: false, status: e.status, error: e.message };
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
   * 超拔祖先／乙位正魂／無緣子女 → 完整牌位名稱（讀 UniversalSalvationEntry.displayName）；
   * 累世冤親債主 → 當事人姓名（member）；贊普 → 自訂名稱（本人…）。
   */
  subjectName: string;
  /** V15R2：認購人／報名成員實際姓名（白米認購人、贊普本人…；舊「本人」由此補實名）。 */
  memberName: string | null;
  /**
   * V14.2：已報名項目最終顯示字串（依宮內辨識規則）：
   *   超拔祖先／乙位正魂／無緣子女 → 完整牌位名稱（不加「類別｜」）
   *   累世冤親債主 → 「累世冤親債主｜姓名」
   *   贊普 → 自訂名稱（本人…）
   */
  displayLabel: string;
  /** V14.4：內容型態（RICE/SPONSOR/TABLET…），供明細顯示白米重量/單價。 */
  contentKind: string;
  /** V14.4：鎖定單價（白米＝每斤金額；null 代表本項不以單價計）。 */
  unitPrice: number | null;
  /** V14.2：陽上人（祖先／乙位正魂，讀 UniversalSalvationEntry；其餘為空）。 */
  yangshangNames: string[];
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
  /** V15R2：舊 Detail 贊普的唯讀相容列（非真實 item，不可從此取消；下次儲存時轉為正式 item）。 */
  readOnlyLegacy: boolean;
};

/**
 * V14.2：以完整牌位名稱顯示的四類 itemKey → 對應 UniversalSalvationEntry 類別。
 * 冤親（US_YUANQIN）刻意不在此：它顯示「累世冤親債主｜當事人姓名」，不取牌位名稱。
 */
const TABLET_NAME_ITEM_CATEGORY: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "UNBORN_CHILD"> = {
  US_ANCESTOR: "ANCESTOR_LINE",
  US_ZHENGHUN: "INDIVIDUAL_SOUL",
  US_WUYUAN: "UNBORN_CHILD",
};

/** V14.2：UniversalSalvationEntry 類別 → 對應計價 itemKey（正式關聯用）。 */
export const ENTRY_CATEGORY_TO_ITEM_KEY: Record<string, string> = {
  ANCESTOR_LINE: "US_ANCESTOR",
  INDIVIDUAL_SOUL: "US_ZHENGHUN",
  DEBT_CREDITOR: "US_YUANQIN",
  UNBORN_CHILD: "US_WUYUAN",
};

/**
 * V14.2：為一筆普渡牌位 UniversalSalvationEntry 建立（並正式連結）對應的計價
 * RitualRegistrationItem。在 createUniversalSalvationEntry 的交易內呼叫。
 *
 * 冪等：該 entry 已有連結的項目則不重建。金額 = 該類別年度單價 × 1（未設定 → 0）。
 * status 沿用主報名（DRAFT）；memberId 由呼叫端決定（編輯區牌位通常 null，
 * 全戶冤親每位帶入該成員）。牌位名稱／陽上／地址一律留在 entry，不複製到項目。
 */
export async function ensureLinkedTabletItem(
  tx: Prisma.TransactionClient,
  params: {
    ritualRecordId: string;
    entryId: string;
    category: string;
    year: number;
    status: RitualRecordStatus;
    memberId?: string | null;
  }
): Promise<void> {
  const itemKey = ENTRY_CATEGORY_TO_ITEM_KEY[params.category];
  if (!itemKey) return;

  const already = await tx.ritualRegistrationItem.findUnique({
    where: { universalSalvationEntryId: params.entryId },
    select: { id: true },
  });
  if (already) return;

  const itemType = await tx.registrationItemType.findUnique({
    where: { key: itemKey },
    select: { id: true },
  });
  if (!itemType) return;

  const prices = await getUniversalSalvationTabletPrices(params.year, tx);
  const unit = tabletUnitPriceFor(itemKey, prices);
  const amountDue = unit !== null ? Math.round(unit * 100) / 100 : 0;

  // V15R5 重複計價修正：實際牌位（entry）與計價項目一律 **1:1**。建立 entry 時，
  // **優先連結一筆既有、尚未連結任何 entry 的同類佔位項目**（來源＝報名對話框的 0 元佔位），
  // 只補上連結、成員與年度單價，**不新增第二筆**——避免同一牌位同時出現「實際牌位名稱」
  // 與「牌位資料待確認」兩筆收費資料。找不到可重用佔位時才新建。
  const placeholder = await tx.ritualRegistrationItem.findFirst({
    where: {
      ritualRecordId: params.ritualRecordId,
      registrationItemTypeId: itemType.id,
      universalSalvationEntryId: null,
      deletedAt: null,
      status: { not: "CANCELLED" },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, amountPaid: true },
  });
  if (placeholder) {
    // 已收款的佔位不覆蓋金額（保護收款快照），只補連結；未收款才帶入年度單價。
    const paid = Number(placeholder.amountPaid);
    await tx.ritualRegistrationItem.update({
      where: { id: placeholder.id },
      data: {
        universalSalvationEntryId: params.entryId,
        memberId: params.memberId ?? undefined,
        quantity: 1,
        status: params.status,
        ...(paid === 0 ? { amountDue, amountUnpaid: amountDue } : {}),
      },
    });
    return;
  }

  await tx.ritualRegistrationItem.create({
    data: {
      ritualRecordId: params.ritualRecordId,
      registrationItemTypeId: itemType.id,
      memberId: params.memberId ?? null,
      quantity: 1,
      amountDue,
      amountPaid: 0,
      amountUnpaid: amountDue,
      status: params.status,
      universalSalvationEntryId: params.entryId,
    },
  });
}

/** V14.2：牌位 entry 被刪除／取消時，同步取消其連結的計價項目（未收款才取消）。 */
export async function cancelLinkedTabletItem(
  tx: Prisma.TransactionClient,
  entryId: string,
  operatorName?: string | null
): Promise<void> {
  const item = await tx.ritualRegistrationItem.findUnique({
    where: { universalSalvationEntryId: entryId },
    select: { id: true, amountPaid: true, status: true, deletedAt: true },
  });
  if (!item || item.deletedAt || item.status === "CANCELLED") return;
  if (Number(item.amountPaid) > 0) return; // 已收款不動，保留歷史
  await tx.ritualRegistrationItem.update({
    where: { id: item.id },
    data: {
      status: "CANCELLED",
      amountUnpaid: 0,
      deletedAt: new Date(),
      deletedByName: operatorName ?? "系統：牌位刪除連動",
    },
  });
}

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
/**
 * V15R2（收斂修正）：普渡編輯頁贊普 → 在**寫入 transaction 內**同步成一筆
 * 正式、**自身計價**的 US_SPONSOR RitualRegistrationItem（不再把金額塞回
 * Detail 共用欄、也不在讀取時寫入）。金額＝數量 × 單價（呼叫端已重算）；
 * customName＝本人（家戶主要聯絡人）。
 *
 * 舊資料安全：僅在贊普「未收款」時建立／更新／轉換（呼叫端以 amountPaid===0 判斷），
 * 已收款的舊 Detail 贊普保留在 Detail（不轉 item、不重算），避免破壞既有收款。
 * 隨喜贊普（US_SPONSOR_DONATION）維持自身獨立一筆 item，不受此函式影響。
 */
export type SponsorItemKey = "US_SPONSOR" | "US_SPONSOR_DONATION";

const SPONSOR_KEY_LABEL: Record<SponsorItemKey, string> = { US_SPONSOR: "贊普", US_SPONSOR_DONATION: "隨喜贊普" };

/**
 * V15R2（姓名修正＋重複整理）：在寫入 transaction 內同步一筆自身計價的 sponsor item。
 *
 * ⚠️ 姓名：一律保存**呼叫端送入的實際姓名**（`customName`）。**不再存「本人」**，也不在
 * 讀取時猜測；空白時存 null（顯示端顯示「姓名待補」）。便利預填由前端負責（可預填目前
 * 信眾／報名人姓名），使用者可修改，DB 存修改後的實際姓名。
 *
 * ⚠️ 歷史重複：不再只 findFirst。若同 (ritualRecordId, registrationItemTypeId, deletedAt=null,
 * status≠CANCELLED) 已存在多筆有效 item：
 *   - 保留一筆（優先保留已收款者，否則最早建立者）並更新；
 *   - 其他**未收款**重複 → 標記 CANCELLED、amountUnpaid=0（避免兩次應收）；
 *   - 若有兩筆以上**已收款**重複 → 丟出明確錯誤，要求人工處理（整個 transaction rollback）。
 *   - active=false 取消時，若有已收款 item → 丟錯（不可用取消勾選繞過退款流程）。
 * 全部只發生於合法寫入 transaction，不放回 GET。
 */
/**
 * 計價模式：
 *  - FIXED（US_SPONSOR 一般贊普）：單價由後端鎖定＝該年度活動固定價（fixedUnitPrice），
 *    **不信任前端單價**；金額＝數量 × 固定價；建立時 lockedUnitPrice 存當下固定價快照，
 *    日後年度價變動不回頭改；編輯既有（未收款）沿用該筆原 lockedUnitPrice 快照重算金額，
 *    不用新年度價覆蓋。年度價未設定且需新建 → 丟明確錯誤（不默默用 0 或前端價）。
 *  - FREE（US_SPONSOR_DONATION 隨喜贊普）：大額自由金額；amount＝amountDue＝amountUnpaid，
 *    quantity＝1，lockedUnitPrice＝amount。絕不套用一般贊普固定價。
 */
export type SponsorPricing =
  | { mode: "FIXED"; quantity: number; fixedUnitPrice: number | null }
  | { mode: "FREE"; amount: number };

export async function syncSponsorItemInTx(
  tx: Prisma.TransactionClient,
  params: {
    ritualRecordId: string;
    /** 贊普＝US_SPONSOR、隨喜贊普＝US_SPONSOR_DONATION（各自一筆、各自計價、可同時存在）。 */
    itemKey: SponsorItemKey;
    /** 是否啟用此項（false＝未勾/取消，未收款則取消該筆 item）。 */
    active: boolean;
    pricing: SponsorPricing;
    /** 認購人／贊普人「實際姓名」（不存「本人」；空白存 null）。 */
    customName?: string | null;
    status: RitualRecordStatus;
    operatorName?: string | null;
  }
): Promise<void> {
  const label = SPONSOR_KEY_LABEL[params.itemKey];
  const type = await tx.registrationItemType.findUnique({ where: { key: params.itemKey }, select: { id: true } });
  if (!type) return;

  // 找出所有有效（未取消未刪除）同 key item，處理歷史重複（含 lockedUnitPrice 快照）。
  const actives = await tx.ritualRegistrationItem.findMany({
    where: { ritualRecordId: params.ritualRecordId, registrationItemTypeId: type.id, deletedAt: null, status: { not: "CANCELLED" } },
    select: { id: true, amountPaid: true, lockedUnitPrice: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  const paidItems = actives.filter((a) => Number(a.amountPaid) > 0);
  // 姓名一律取實際輸入；空白存 null（不存「本人」）。
  const name = (params.customName ?? "").trim() || null;

  if (params.active) {
    if (paidItems.length > 1) {
      throw new Error(`此報名有多筆已收款的${label}，請先於收款中心處理後再由人工整理，系統不自動變更`);
    }
    // 保留者：已收款者優先，否則最早建立者。
    const keeper = paidItems[0] ?? actives[0] ?? null;
    // 取消其他未收款重複（避免兩次應收）。
    for (const a of actives) {
      if (keeper && a.id === keeper.id) continue;
      if (Number(a.amountPaid) > 0) {
        throw new Error(`此報名有多筆已收款的${label}，請人工處理`);
      }
      await tx.ritualRegistrationItem.update({
        where: { id: a.id },
        data: { status: "CANCELLED", amountUnpaid: 0, deletedAt: new Date(), deletedByName: params.operatorName ?? `系統：整理重複${label}` },
      });
    }

    // 依計價模式決定 數量／鎖定單價／金額（後端唯一計算，不信任前端一般贊普單價）。
    let qty: number;
    let lockedUnitPrice: number;
    let amount: number;
    if (params.pricing.mode === "FIXED") {
      qty = Math.max(1, Math.floor(params.pricing.quantity) || 1);
      // 編輯既有未收款：沿用該筆原 lockedUnitPrice 快照；新建：用當下年度固定價。
      const existingLocked = keeper && Number(keeper.amountPaid) === 0 && keeper.lockedUnitPrice != null ? Number(keeper.lockedUnitPrice) : null;
      const unit = existingLocked ?? params.pricing.fixedUnitPrice;
      if (unit == null || !Number.isFinite(unit)) {
        throw new Error(`尚未設定 ${label} 的年度固定單價，請先於活動設定頁設定後再報名`);
      }
      lockedUnitPrice = unit;
      amount = Math.round(qty * unit);
    } else {
      // FREE：大額自由金額。
      qty = 1;
      amount = Math.max(0, Math.round(Number(params.pricing.amount) || 0));
      lockedUnitPrice = amount;
    }

    if (!keeper) {
      const rec = await tx.ritualRecord.findUnique({ where: { id: params.ritualRecordId }, select: { householdId: true } });
      const member = rec
        ? await tx.member.findFirst({ where: { householdId: rec.householdId, deletedAt: null }, orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }], select: { id: true } })
        : null;
      await tx.ritualRegistrationItem.create({
        data: {
          ritualRecordId: params.ritualRecordId,
          registrationItemTypeId: type.id,
          memberId: member?.id ?? null,
          quantity: qty,
          customName: name, // 實際姓名（可為 null → 顯示「姓名待補」）
          lockedUnitPrice,
          amountDue: amount,
          amountPaid: 0,
          amountUnpaid: amount,
          feeChoice: "FIXED",
          status: params.status,
        },
      });
    } else if (Number(keeper.amountPaid) === 0) {
      // 未收款才更新數量／金額／姓名；FIXED 沿用原鎖定價快照（不用新年度價覆蓋）。
      await tx.ritualRegistrationItem.update({
        where: { id: keeper.id },
        data: {
          quantity: qty,
          lockedUnitPrice,
          customName: name,
          amountDue: amount,
          amountUnpaid: amount,
          status: params.status,
        },
      });
    }
    // keeper 已收款：金額／鎖定價不動；姓名為正式資料，允許更新姓名。
    else if (name !== null) {
      await tx.ritualRegistrationItem.update({ where: { id: keeper.id }, data: { customName: name } });
    }
  } else {
    // active=false：取消所有未收款有效 item；有已收款則丟錯（不可用取消勾選繞過退款）。
    if (paidItems.length > 0) {
      throw new Error(`此報名的${label}已有收款，請先於收款中心處理退款後再取消`);
    }
    for (const a of actives) {
      await tx.ritualRegistrationItem.update({
        where: { id: a.id },
        data: { status: "CANCELLED", amountUnpaid: 0, deletedAt: new Date(), deletedByName: params.operatorName ?? `系統：取消${label}` },
      });
    }
  }
}

export async function listRegisteredItems(ritualRecordId: string): Promise<RegisteredItemView[]> {
  // V15R2（收斂修正）：**純讀取**——不再於讀取時 create／update／upsert（原本會補建贊普
  // 索引、整理重複草稿）。資料一致化改在各自「寫入 transaction」內完成（見
  // syncSponsorItemInTx／registerItemsBatch 冪等）；重複草稿整理改由寫入路徑或
  // 管理端 cleanupDuplicateDraftItems 主動執行，避免 GET／READONLY 瀏覽產生資料異動。
  // 併行讀取；祭改應收（PurificationEntry）另置一組，維持每組 ≤3 個平行查詢（不巨型扇出）。
  const [[rows, salvationDetail, lantern], purificationEntries] = await Promise.all([
    Promise.all([
    prisma.ritualRegistrationItem.findMany({
      where: { ritualRecordId, deletedAt: null },
      include: {
        registrationItemType: true,
        member: { select: { name: true } },
        // V14.2：正式 1:1 關聯——牌位名稱／陽上人／地址一律讀這一筆 entry。
        universalSalvationEntry: {
          select: { displayName: true, tabletAddress: true, yangshangName: true, yangshangNames: true },
        },
      },
      orderBy: [{ registrationItemType: { sortOrder: "asc" } }, { createdAt: "asc" }],
    }),
    prisma.universalSalvationDetail.findUnique({
      where: { ritualRecordId },
      select: {
        amountDue: true, amountPaid: true, amountUnpaid: true,
        isSponsor: true, sponsorUnitPrice: true, sponsorQuantity: true, sponsorAmount: true,
        ritualRecord: {
          select: {
            status: true,
            // 舊 Detail 贊普唯讀相容顯示用：取本戶主要聯絡人姓名補實名（不寫入）。
            household: { select: { members: { where: { deletedAt: null }, orderBy: [{ isPrimaryContact: "desc" }, { createdAt: "asc" }], take: 1, select: { name: true } } } },
          },
        },
      },
    }),
    prisma.lanternRegistration.findUnique({
      where: { ritualRecordId },
      select: { amountDue: true, amountPaid: true, amountUnpaid: true },
    }),
    ]),
    // V15R5.1：祭改（PURIFICATION）的真正收費來源＝PurificationEntry（feeStatus=CHARGEABLE＋amountDue）；
    // 其 RitualRegistrationItem.amountDue 恆為 0。此處**唯讀**取回本 record 的祭改應收，供顯示／總計
    // 讀真正金額——不寫回 item、不動收款/財務 adapter、不造成雙重應收。
    prisma.purificationEntry.findMany({
      where: { ritualRecordId, deletedAt: null, status: "ACTIVE" },
      select: { memberId: true, amountDue: true, amountPaid: true, amountUnpaid: true, feeStatus: true },
    }),
  ]);

  // 以 memberId 對應祭改應收（一位成員一筆；item 與 entry 建立時 memberId 相同）。
  const purificationByMember = new Map<string, (typeof purificationEntries)[number]>();
  for (const pe of purificationEntries) {
    if (pe.memberId && !purificationByMember.has(pe.memberId)) purificationByMember.set(pe.memberId, pe);
  }

  const views: RegisteredItemView[] = rows.map((r) => {
    const kind = r.registrationItemType.contentKind;
    // 每個項目一律用本項自身金額為收費來源（贊普／隨喜贊普各自獨立，不共用 Detail、
    // 不依陣列順序）。SPONSOR→UniversalSalvationDetail 只餘 LANTERN 例外（年度燈金額
    // 記在 LanternRegistration，避免兩筆應收）。
    let amountDue = Number(r.amountDue);
    let amountPaid = Number(r.amountPaid);
    let amountUnpaid = Number(r.amountUnpaid);
    if (kind === "LANTERN" && lantern) {
      amountDue = Number(lantern.amountDue);
      amountPaid = Number(lantern.amountPaid);
      amountUnpaid = Number(lantern.amountUnpaid);
    } else if (kind === "PURIFICATION") {
      // V15R5.1：祭改讀真正收費來源 PurificationEntry（item.amountDue 恆 0）。
      // 有效收費狀態（feeStatus !== "UNSET"）才覆寫金額；查不到或未設定單價 → 0。
      const pe = r.memberId ? purificationByMember.get(r.memberId) : undefined;
      if (pe && pe.feeStatus !== "UNSET") {
        amountDue = pe.amountDue != null ? Number(pe.amountDue) : 0;
        amountPaid = Number(pe.amountPaid);
        amountUnpaid = Number(pe.amountUnpaid);
      } else {
        amountDue = 0;
        amountPaid = 0;
        amountUnpaid = 0;
      }
    }

    const key = r.registrationItemType.key;
    const categoryName = r.registrationItemType.name;
    const memberName = r.member?.name ?? null;
    // 正式關聯的牌位（唯一來源）；舊資料未連結時才退回成員姓名。
    const linked = r.universalSalvationEntry;
    const linkedYangshang = linked ? resolveYangshangNames(linked.yangshangNames, linked.yangshangName) : [];

    // 依宮內辨識規則決定名稱、顯示字串、陽上、地址。
    let subjectName: string;
    let displayLabel: string;
    let yangshangNames: string[] = [];
    let tabletAddress: string | null = null;

    if (key in TABLET_NAME_ITEM_CATEGORY) {
      // 超拔祖先／乙位正魂／無緣子女：**只認正式關聯牌位名稱**（讀連結 entry），不加「類別｜」。
      // V15R5 正式規格：建立報名即建立 linked Draft，故一律有連結 entry——
      //   已連結且有名稱 → 顯示實際牌位名稱；
      //   已連結但名稱留空（尚未填）→ 顯示「尚缺牌位姓名」（同一筆 Draft 的待補提示，非另一個報名項目）；
      //   未連結（僅舊資料未回填 FK）→ 顯示「牌位資料待確認」，提醒人工補上正式關聯。
      subjectName = linked ? (linked.displayName.trim() ? linked.displayName : "尚缺牌位姓名") : "牌位資料待確認";
      displayLabel = subjectName;
      yangshangNames = linkedYangshang;
      tabletAddress = linked?.tabletAddress ?? null;
    } else if (key === "US_YUANQIN") {
      // 累世冤親債主：顯示「累世冤親債主｜當事人姓名」（固定格式，不要「姓名之…」）。
      // 類別名一律正名為「累世冤親債主」（種子名可能仍是「冤親債主」）；當事人姓名讀連結
      // entry，退回成員姓名（memberId 綁定）。
      subjectName = linked?.displayName ?? r.customName ?? memberName ?? "姓名待補";
      displayLabel = `${displayDebtCreditorName(categoryName)}｜${subjectName}`;
    } else if (kind === "SPONSOR") {
      // 贊普／隨喜贊普：顯示「類別｜實際姓名」。舊資料存「本人」或空 → 讀時以 member 關聯補實名
      //（唯讀，不寫入）；仍找不到 → 顯示「姓名待補」，絕不顯示「本人」。
      const real = r.customName && r.customName.trim() && r.customName.trim() !== "本人" ? r.customName.trim() : null;
      subjectName = real ?? memberName ?? "姓名待補";
      displayLabel = `${categoryName}｜${subjectName}`;
    } else if (kind === "RICE") {
      // V15R2 驗收：白米顯示認購人＋斤數；單價與金額另欄呈現（沿用本項自身金額）。
      subjectName = memberName ?? r.customName ?? "本人";
      displayLabel = `白米 ${r.quantity} 斤`;
    } else {
      subjectName = r.customName ?? categoryName;
      displayLabel = subjectName;
    }

    // V15R2：贊普／隨喜贊普各自的單價一律讀本項自身鎖定單價（不再讀 Detail）。
    const unitPrice = r.lockedUnitPrice !== null && r.lockedUnitPrice !== undefined ? Number(r.lockedUnitPrice) : null;

    return {
      id: r.id,
      registrationItemTypeId: r.registrationItemTypeId,
      itemKey: r.registrationItemType.key,
      itemName: r.customName ?? r.registrationItemType.name,
      categoryName,
      subjectName,
      memberName,
      displayLabel,
      contentKind: kind,
      unitPrice,
      yangshangNames,
      tabletAddress,
      activityGroupName: r.registrationItemType.activityGroupName,
      memberId: r.memberId,
      quantity: r.quantity,
      customName: r.customName,
      amountDue,
      amountPaid,
      amountUnpaid,
      status: r.status,
      readOnlyLegacy: false,
    };
  });

  // V15R2：舊資料相容（**唯讀、不寫入**）——只有 Detail 記著贊普、且尚未轉成 US_SPONSOR
  // item 的舊資料，用一筆「唯讀相容 view」顯示，讓舊贊普看得到；不建 DB 列、不可從此取消
  // （下一次以有寫入權限儲存普渡資料時，由 syncSponsorItemInTx 於同一 transaction 轉成正式 item）。
  // 判斷：Detail.isSponsor 且 Detail 仍有應收（amountDue>0，代表尚未轉 item）且清單內沒有 US_SPONSOR item。
  const hasSponsorItem = views.some((v) => v.itemKey === "US_SPONSOR");
  if (
    salvationDetail?.isSponsor &&
    !hasSponsorItem &&
    Number(salvationDetail.amountDue ?? 0) > 0
  ) {
    const legacyAmount = Number(salvationDetail.sponsorAmount ?? salvationDetail.amountDue ?? 0);
    // 舊 Detail 贊普無 customName：以本戶主要聯絡人姓名唯讀相容顯示；找不到 → 姓名待補（不顯示「本人」）。
    const legacyName = salvationDetail.ritualRecord?.household?.members?.[0]?.name ?? "姓名待補";
    views.push({
      id: `legacy-sponsor:${ritualRecordId}`,
      registrationItemTypeId: "",
      itemKey: "US_SPONSOR",
      itemName: "贊普（舊資料）",
      categoryName: "贊普",
      subjectName: legacyName,
      memberName: legacyName === "姓名待補" ? null : legacyName,
      displayLabel: `贊普（舊資料）｜${legacyName}`,
      contentKind: "SPONSOR",
      unitPrice: salvationDetail.sponsorUnitPrice != null ? Number(salvationDetail.sponsorUnitPrice) : null,
      yangshangNames: [],
      tabletAddress: null,
      activityGroupName: "中元普渡",
      memberId: null,
      quantity: salvationDetail.sponsorQuantity ?? 1,
      customName: null,
      amountDue: Number(salvationDetail.amountDue ?? legacyAmount),
      amountPaid: Number(salvationDetail.amountPaid ?? 0),
      amountUnpaid: Number(salvationDetail.amountUnpaid ?? 0),
      status: salvationDetail.ritualRecord?.status ?? "DRAFT",
      readOnlyLegacy: true,
    });
  }

  return views;
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
    return { ok: false, status: 409, error: "此項目已有收款／收據，請先於收款管理處理退款後再取消" };
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
