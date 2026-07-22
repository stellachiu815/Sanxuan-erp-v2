import { Prisma, PurificationPaymentStatus, PurificationEntryStatus } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { solarToLunar, type LunarDate } from "@/lib/lunar";
import {
  normalizeGender,
  formatJishi,
  formatChineseAge,
  formatFormalLunarDate,
  digitsToChineseDigits,
  type NormalizedGender,
} from "@/lib/chineseNumerals";
import { resolveNominalAgeForMinguoYear, type AgeResolution } from "@/lib/purificationAge";
import { assignSequentialNumbers, paginateForPrinting } from "@/lib/purificationNumbering";
import { optimizeCell, type CellContent, type CellOptimizationResult } from "@/lib/purificationLayout";
import { checkPurificationPrintReadiness } from "@/lib/purificationConsistency";
import { formatTempleEventName } from "@/lib/templeEventNaming";
import { resolveFeeStatusUpdate } from "@/lib/collectionCenterRules";

import { upsertParticipantsInTransaction } from "@/lib/ritualParticipants";
/**
 * 祭改（PURIFICATION）核心業務邏輯。
 *
 * ⚠️ V8.1「宮務活動中心」重大異動：這個檔案原本（V9.0）操作自己專屬的
 * PurificationYear / PurificationRegistration / PurificationPrintBatch 三張表，
 * 這一輪應你的要求，改成操作所有宮務活動共用的 TempleEvent / RitualRecord /
 * PurificationEntry / TempleEventPrintBatch（見 prisma/schema.prisma 最新的
 * 「V8.1 宮務活動中心」段落）。
 *
 * 刻意保留這個檔案裡每一個 exported 函式的名稱、參數、回傳格式完全不變
 * ——所有 API route（src/app/api/purification/**）跟前端元件呼叫這些函式
 * 的方式完全不用改，只有這個檔案內部「查哪張表」變了。這樣可以確保：
 * 1. 這次的重大架構異動不會意外波及已經測試過的 API 合約；
 * 2. 之後如果要再檢視這次遷移是否正確，只需要比對這一個檔案，不需要
 *    同時追蹤十幾支 route 檔案的變動。
 *
 * 純邏輯模組（chineseNumerals / purificationNumbering / purificationLayout /
 * purificationAge / purificationConsistency，全部都不 import Prisma、可以在
 * 沙盒裡直接跑自動測試）完全不受這次遷移影響，維持原樣。
 *
 * 資料存放位置的對照（V9.0 → V8.1）：
 *   PurificationYear         → TempleEvent（activityType = "PURIFICATION"）
 *   PurificationRegistration → PurificationEntry（掛在 RitualRecord 底下）
 *   PurificationPrintBatch   → TempleEventPrintBatch
 *   PurificationBannedNumber → 不變（本來就是跨年度全域清單）
 *   （新增）TempleEventBannedNumber → 單一活動年度「額外」禁用號碼，
 *   跟全域清單一起套用，見 getExtraBannedNumbers()。
 *
 * 行為上唯一的實質差異：每一位報名者現在都掛在「一戶、一年、一種活動
 * 類型」的 RitualRecord 底下（這是 V2.0 就有、普渡本來就在用的通用架構），
 * 所以「臨時報名者」這次起也必須指定所屬家戶（householdId 必填）——V9.0
 * 原本允許完全沒有家戶關聯、純手動輸入地址的臨時報名者，這個彈性在這次
 * 遷移後無法保留（見交付說明的誠實限制章節）。一般報名（從信眾主資料選人）
 * 因為原本就會一併帶出該信眾的所屬家戶，不受影響。
 */

// ============================================================
// 一、報名資料的「解析後檢視」（Resolved View）
// ============================================================

export type PurificationRegistrationView = {
  id: string;
  templeEventId: string;
  number: number | null;
  status: PurificationEntryStatus;
  isTemporaryName: boolean;
  displayName: string;
  gender: NormalizedGender;
  lunar: LunarDate | null;
  address: string | null;
  phone: string | null;
  paymentStatus: PurificationPaymentStatus;
  paymentAmount: Prisma.Decimal | null;
  notes: string | null;
  registeredAt: Date;
  isPrinted: boolean;
  printedAt: Date | null;
  printBatchId: string | null;
  memberId: string | null;
  householdId: string | null;
};

type EntryWithRelations = Prisma.PurificationEntryGetPayload<{
  include: { member: true; ritualRecord: { include: { household: true } } };
}>;

/** 從國曆/農曆生日欄位（不論來自 Member 或臨時報名者的 manual 欄位）解析出農曆生日。 */
function resolveLunarBirthday(fields: {
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
}): LunarDate | null {
  if (fields.lunarBirthYear && fields.lunarBirthMonth && fields.lunarBirthDay) {
    return {
      year: fields.lunarBirthYear,
      month: fields.lunarBirthMonth,
      day: fields.lunarBirthDay,
      isLeapMonth: fields.lunarIsLeapMonth,
    };
  }
  if (fields.solarBirthDate) {
    return solarToLunar(fields.solarBirthDate);
  }
  return null;
}

/**
 * 把一筆 PurificationEntry（含 member/ritualRecord.household 關聯）解析成
 * 畫面/列印共用的檢視格式。memberId 有值且不是臨時報名者時，姓名/性別/
 * 生日一律從 member 即時讀出；地址/電話一律從這筆報名所屬的 RitualRecord
 * 關聯的 household 讀出（不論是否為臨時報名者，因為地址/電話本來就只存在
 * Household，不是 Member 的欄位）。
 */
export function resolvePurificationRegistrationView(entry: EntryWithRelations): PurificationRegistrationView {
  const useMember = !entry.isTemporaryName && entry.member;

  const displayName = useMember ? entry.member!.name : entry.manualDisplayName ?? "（未命名）";
  const genderRaw = useMember ? entry.member!.gender : entry.manualGender;
  const lunar = useMember
    ? resolveLunarBirthday({
        solarBirthDate: entry.member!.solarBirthDate,
        lunarBirthYear: entry.member!.lunarBirthYear,
        lunarBirthMonth: entry.member!.lunarBirthMonth,
        lunarBirthDay: entry.member!.lunarBirthDay,
        lunarIsLeapMonth: entry.member!.lunarIsLeapMonth,
      })
    : resolveLunarBirthday({
        solarBirthDate: entry.manualSolarBirthDate,
        lunarBirthYear: entry.manualLunarBirthYear,
        lunarBirthMonth: entry.manualLunarBirthMonth,
        lunarBirthDay: entry.manualLunarBirthDay,
        lunarIsLeapMonth: entry.manualLunarIsLeapMonth,
      });

  // 地址／電話：一律從這筆報名掛載的 RitualRecord → Household 讀取；
  // 臨時報名者如果那個家戶剛好沒有填地址/電話，才用 manualAddress/manualPhone 頂替。
  const address = entry.ritualRecord.household?.address ?? entry.manualAddress ?? null;
  const phone = entry.ritualRecord.household?.phone ?? entry.manualPhone ?? null;

  return {
    id: entry.id,
    templeEventId: entry.templeEventId,
    number: entry.number,
    status: entry.status,
    isTemporaryName: entry.isTemporaryName,
    displayName,
    gender: normalizeGender(genderRaw),
    lunar,
    address,
    phone,
    paymentStatus: entry.paymentStatus,
    paymentAmount: entry.paymentAmount,
    notes: entry.notes,
    registeredAt: entry.registeredAt,
    isPrinted: entry.isPrinted,
    printedAt: entry.printedAt,
    printBatchId: entry.printBatchId,
    memberId: entry.memberId,
    householdId: entry.ritualRecord.householdId,
  };
}

// ============================================================
// 二、年度歲數／小人頭欄位文字／列印前檢查（整合三個純邏輯模組）
// ============================================================

export type PurificationPrintFields = {
  view: PurificationRegistrationView;
  ageResolution: AgeResolution;
  jishiText: string | null;
  lunarDateText: { monthText: string; dayText: string; combined: string } | null;
  addressText: string; // 已轉換成中文國字的地址（逐字讀法）
  cellContent: CellContent; // 給 purificationLayout.optimizeCell 使用
  layout: CellOptimizationResult;
  readiness: { canPrint: boolean; issues: string[] };
};

/** 把一筆解析後的報名資料，組成小人頭列印所需要的完整文字內容與版面最佳化結果。 */
export function buildPurificationPrintFields(
  view: PurificationRegistrationView,
  targetMinguoYear: number,
  extraBannedNumbers: Iterable<number>,
  isDuplicateNumber: boolean
): PurificationPrintFields {
  const ageResolution = resolveNominalAgeForMinguoYear(view.lunar?.year ?? null, targetMinguoYear);
  const jishiText = formatJishi(view.gender);
  const lunarDateText = view.lunar
    ? formatFormalLunarDate(view.lunar.month, view.lunar.day, view.lunar.isLeapMonth)
    : null;
  const addressText = digitsToChineseDigits(view.address ?? "");

  const middleParts: string[] = [];
  if (ageResolution.ok) middleParts.push(formatChineseAge(ageResolution.age));
  if (lunarDateText) middleParts.push(lunarDateText.combined);
  if (jishiText) middleParts.push(jishiText);

  const cellContent: CellContent = {
    numberText: view.number !== null ? String(view.number) : "",
    nameText: view.displayName,
    middleText: middleParts.join(""),
    addressText,
  };

  const layout = optimizeCell(cellContent);

  const bannedSet = new Set(extraBannedNumbers);
  const isBannedNumber = view.number !== null && (String(view.number).includes("44") || bannedSet.has(view.number));

  const readiness = checkPurificationPrintReadiness({
    gender: view.gender,
    hasBirthYearData: view.lunar !== null,
    ageResolutionOk: ageResolution.ok,
    address: view.address,
    number: view.number,
    isBannedNumber,
    isDuplicateNumber,
    layoutNeedsManualReview: layout.needsManualReview,
    layoutReviewReasons: layout.reviewReasons,
  });

  return { view, ageResolution, jishiText, lunarDateText, addressText, cellContent, layout, readiness };
}

// ============================================================
// 三、年度管理：建立年度／沿用去年
// ============================================================

export type PurificationResult<T> = { ok: true; data: T } | { ok: false; status: number; error: string };

/** 年度顯示名稱：民國年度用「逐字讀法」（跟地址門牌一樣），例如 115 →「一一五」。 */
export function formatPurificationYearName(year: number): string {
  return formatTempleEventName(year, "祭改");
}

/** 這個年度是否已經存在（用來檢查唯一性，內部共用）。 */
async function findPurificationEvent(year: number) {
  return prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType: "PURIFICATION", year } },
  });
}

/** 建立新年度祭改活動（不含沿用去年資料，見下方 copyPurificationYearFromPrevious）。 */
export async function createPurificationYear(
  year: number,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string }>> {
  const existing = await findPurificationEvent(year);
  if (existing) {
    return { ok: false, status: 409, error: `民國 ${year} 年度的祭改活動已經存在` };
  }
  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.templeEvent.create({
      data: { activityType: "PURIFICATION", year, name: formatPurificationYearName(year) },
    });
    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: event.id,
        action: "CREATE",
        afterData: event,
        operatorName,
      },
      tx
    );
    return event;
  });
  return { ok: true, data: { id: created.id } };
}

export type PurificationYearDiffItem = {
  kind: "ADDED" | "CANCELLED_LAST_YEAR" | "ADDRESS_CHANGED" | "BIRTHDAY_CHANGED" | "GENDER_NEEDS_CONFIRM";
  displayName: string;
  detail?: string;
};

/**
 * 建立/取得「這一戶、這個活動年度」的 RitualRecord（同一戶、同一年、
 * 同一種活動類型只會有一筆，見 schema 的 @@unique([householdId, year,
 * activityType])）。祭改的報名者一律掛在這筆主檔底下。
 */
async function getOrCreateRitualRecordForEvent(
  tx: Prisma.TransactionClient,
  event: { id: string; year: number },
  householdId: string
) {
  const existing = await tx.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: { householdId, year: event.year, activityType: "PURIFICATION" },
    },
  });
  if (existing) {
    if (existing.templeEventId !== event.id) {
      // 理論上不會發生（同一年同一活動只會有一個 TempleEvent），保險起見同步一次。
      return tx.ritualRecord.update({ where: { id: existing.id }, data: { templeEventId: event.id } });
    }
    return existing;
  }
  return tx.ritualRecord.create({
    data: {
      householdId,
      year: event.year,
      activityType: "PURIFICATION",
      templeEventId: event.id,
      status: "CONFIRMED",
      registrationSource: "ACTIVITY_PAGE",
    },
  });
}

/**
 * 沿用去年祭改資料：複製參加者/個人地址/備註/家戶關係/活動年度額外禁用
 * 號碼，但不沿用歲數（本來就不存欄位，新年度重新計算）、編號（重設為
 * null，新年度重新編列）、收款狀態（重設為未收）、列印紀錄（重設為未列印）。
 * 只複製來源年度狀態是 ACTIVE 或 SUPPLEMENTARY（仍然有效）的報名者。
 */
export async function copyPurificationYearFromPrevious(
  newYear: number,
  sourceYearId: string,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string; diffs: PurificationYearDiffItem[] }>> {
  const existing = await findPurificationEvent(newYear);
  if (existing) {
    return { ok: false, status: 409, error: `民國 ${newYear} 年度的祭改活動已經存在` };
  }
  const source = await prisma.templeEvent.findUnique({ where: { id: sourceYearId } });
  if (!source || source.activityType !== "PURIFICATION") {
    return { ok: false, status: 404, error: "找不到來源年度" };
  }

  const sourceEntries = await prisma.purificationEntry.findMany({
    where: { templeEventId: sourceYearId, deletedAt: null },
    include: { member: true, ritualRecord: { include: { household: true } } },
  });
  const sourceActive = sourceEntries.filter((e) => e.status === "ACTIVE" || e.status === "SUPPLEMENTARY");

  const created = await prisma.$transaction(async (tx) => {
    const event = await tx.templeEvent.create({
      data: {
        activityType: "PURIFICATION",
        year: newYear,
        name: formatPurificationYearName(newYear),
        copiedFromEventId: sourceYearId,
      },
    });

    // 沿用去年這個活動年度「額外」禁用的號碼設定（全域禁用清單本來就一直生效，不用複製）。
    const sourceBanned = await tx.templeEventBannedNumber.findMany({ where: { templeEventId: sourceYearId } });
    for (const b of sourceBanned) {
      await tx.templeEventBannedNumber.create({
        data: { templeEventId: event.id, number: b.number, reason: b.reason },
      });
    }

    for (const entry of sourceActive) {
      const ritualRecord = await getOrCreateRitualRecordForEvent(tx, event, entry.ritualRecord.householdId);
      const newEntry = await tx.purificationEntry.create({
        data: {
          ritualRecordId: ritualRecord.id,
          templeEventId: event.id,
          memberId: entry.memberId,
          isTemporaryName: entry.isTemporaryName,
          manualDisplayName: entry.manualDisplayName,
          manualGender: entry.manualGender,
          manualSolarBirthDate: entry.manualSolarBirthDate,
          manualLunarBirthYear: entry.manualLunarBirthYear,
          manualLunarBirthMonth: entry.manualLunarBirthMonth,
          manualLunarBirthDay: entry.manualLunarBirthDay,
          manualLunarIsLeapMonth: entry.manualLunarIsLeapMonth,
          manualAddress: entry.manualAddress,
          manualPhone: entry.manualPhone,
          notes: entry.notes,
          // 歲數不存欄位（新年度重新計算）；編號/收款/列印狀態全部重設為預設值。
        },
      });
      await recordVersion(
        {
          entityType: "PurificationEntry",
          entityId: newEntry.id,
          action: "CREATE",
          afterData: newEntry,
          changeNote: `由 ${source.year} 年度沿用建立`,
          operatorName,
        },
        tx
      );

      /**
       * V13.4 指令十八：祭改報名也要寫入 RitualParticipant。
       * 臨時報名者（isTemporaryName，沒有 memberId）不寫——他們不是
       * 系統裡的信眾，沒有 Member 可以關聯。
       */
      if (newEntry.memberId) {
        await upsertParticipantsInTransaction(
          tx,
          ritualRecord.id,
          [newEntry.memberId],
          operatorName
        );
      }
    }

    await recordVersion(
      {
        entityType: "TempleEvent",
        entityId: event.id,
        action: "CREATE",
        afterData: event,
        changeNote: `沿用自 ${source.year} 年度`,
        operatorName,
      },
      tx
    );

    return event;
  });

  const diffs = buildPurificationYearDiffs(sourceEntries, sourceActive);

  return { ok: true, data: { id: created.id, diffs } };
}

/**
 * 建立「去年與今年差異比對」清單，供沿用去年資料完成後的提示畫面使用。
 *
 * 需求「十四」要求比對：新增/取消/地址變更/生日變更/性別資料待確認。這個
 * 系統依設計原則不重複儲存姓名/性別/生日/地址（一律即時引用信眾主資料/
 * 家戶資料，避免資料脫鉤），所以「地址變更」「生日變更」無法用「去年存的
 * 值」跟「今年存的值」做精確比對——因為兩邊本來就是同一份即時資料。
 *
 * 因此這裡採用誠實、有實際根據的做法：如果這筆報名對應的信眾/家戶資料，
 * 是在「去年那筆報名建立之後」才被修改過（member.updatedAt 或
 * household.updatedAt 晚於去年報名的 registeredAt），就標記「地址變更」或
 * 「生日變更」為「資料可能異動，請人工核對」提示。
 */
function buildPurificationYearDiffs(
  allSourceEntries: EntryWithRelations[],
  copiedEntries: EntryWithRelations[]
): PurificationYearDiffItem[] {
  const diffs: PurificationYearDiffItem[] = [];

  for (const entry of copiedEntries) {
    const view = resolvePurificationRegistrationView(entry);
    diffs.push({ kind: "ADDED", displayName: view.displayName });

    if (view.gender === "UNKNOWN") {
      diffs.push({ kind: "GENDER_NEEDS_CONFIRM", displayName: view.displayName, detail: "性別資料待確認" });
    }

    if (!entry.isTemporaryName) {
      if (entry.ritualRecord.household && entry.ritualRecord.household.updatedAt > entry.registeredAt) {
        diffs.push({
          kind: "ADDRESS_CHANGED",
          displayName: view.displayName,
          detail: "家戶資料在去年報名之後曾經異動，請確認地址是否需要更新",
        });
      }
      if (entry.member && entry.member.updatedAt > entry.registeredAt) {
        diffs.push({
          kind: "BIRTHDAY_CHANGED",
          displayName: view.displayName,
          detail: "信眾主資料在去年報名之後曾經異動，請確認生日/性別是否需要更新",
        });
      }
    }
  }

  const copiedIds = new Set(copiedEntries.map((e) => e.id));
  for (const entry of allSourceEntries) {
    if (copiedIds.has(entry.id)) continue;
    if (entry.status === "CANCELLED") {
      const view = resolvePurificationRegistrationView(entry);
      diffs.push({
        kind: "CANCELLED_LAST_YEAR",
        displayName: view.displayName,
        detail: "去年已取消，本次沿用不會複製這筆資料",
      });
    }
  }

  return diffs;
}

// ============================================================
// 四、報名／取消／收款狀態
// ============================================================

export type RegisterPurificationEntrantInput = {
  memberId?: string | null;
  householdId?: string | null;
  isTemporaryName?: boolean;
  manualDisplayName?: string | null;
  manualGender?: string | null;
  manualSolarBirthDate?: Date | null;
  manualLunarBirthYear?: number | null;
  manualLunarBirthMonth?: number | null;
  manualLunarBirthDay?: number | null;
  manualLunarIsLeapMonth?: boolean;
  manualAddress?: string | null;
  manualPhone?: string | null;
  paymentStatus?: PurificationPaymentStatus;
  paymentAmount?: number | null;
  notes?: string | null;
};

/** 這個活動年度目前有效的「額外禁用號碼」＝全域清單 + 這個年度專屬清單。 */
async function getExtraBannedNumbers(
  tx: Prisma.TransactionClient | typeof prisma,
  templeEventId: string
): Promise<number[]> {
  const [globalRows, eventRows] = await Promise.all([
    tx.purificationBannedNumber.findMany({ select: { number: true } }),
    tx.templeEventBannedNumber.findMany({ where: { templeEventId }, select: { number: true } }),
  ]);
  return [...globalRows.map((r) => r.number), ...eventRows.map((r) => r.number)];
}

/**
 * 報名一位祭改參加者。
 *
 * 對應需求「六、祭改編號自動編列」：報名完成後立即由系統自動編列編號
 * （接續這個年度目前最後一個有效編號，跳過禁用編號）。這件事在年度尚未
 * 鎖定（numberingLocked=false，還沒開始列印）時，本質上就是「初次編號」；
 * 年度已經鎖定之後才新增的報名者，則自動視為「補報」（status=SUPPLEMENTARY），
 * 同樣接續最後編號繼續編列。
 *
 * ⚠️ V8.1 起，householdId 必填（見檔案頂端的說明：報名者現在一律掛在
 * 「一戶、一年、一種活動類型」的 RitualRecord 底下）。
 */
export async function registerPurificationEntrant(
  purificationYearId: string,
  input: RegisterPurificationEntrantInput,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string; number: number }>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: purificationYearId } });
  if (!event || event.activityType !== "PURIFICATION") {
    return { ok: false, status: 404, error: "找不到這個祭改年度" };
  }

  const isTemporaryName = Boolean(input.isTemporaryName);
  if (!isTemporaryName && !input.memberId) {
    return { ok: false, status: 400, error: "請選擇信眾，或標記為臨時報名並填寫姓名" };
  }
  if (isTemporaryName && !input.manualDisplayName?.trim()) {
    return { ok: false, status: 400, error: "臨時報名請填寫姓名" };
  }
  if (!input.householdId) {
    return { ok: false, status: 400, error: "請選擇這位報名者所屬的家戶" };
  }

  const created = await prisma.$transaction(async (tx) => {
    const ritualRecord = await getOrCreateRitualRecordForEvent(tx, event, input.householdId!);
    const extraBanned = await getExtraBannedNumbers(tx, event.id);
    const currentMax = await tx.purificationEntry.aggregate({
      where: { templeEventId: event.id, number: { not: null } },
      _max: { number: true },
    });
    const [assignedNumber] = assignSequentialNumbers(1, currentMax._max.number ?? 0, extraBanned);

    const entry = await tx.purificationEntry.create({
      data: {
        ritualRecordId: ritualRecord.id,
        templeEventId: event.id,
        number: assignedNumber,
        memberId: isTemporaryName ? null : input.memberId,
        isTemporaryName,
        manualDisplayName: isTemporaryName ? input.manualDisplayName?.trim() : null,
        manualGender: isTemporaryName ? input.manualGender ?? null : null,
        manualSolarBirthDate: isTemporaryName ? input.manualSolarBirthDate ?? null : null,
        manualLunarBirthYear: isTemporaryName ? input.manualLunarBirthYear ?? null : null,
        manualLunarBirthMonth: isTemporaryName ? input.manualLunarBirthMonth ?? null : null,
        manualLunarBirthDay: isTemporaryName ? input.manualLunarBirthDay ?? null : null,
        manualLunarIsLeapMonth: isTemporaryName ? Boolean(input.manualLunarIsLeapMonth) : false,
        manualAddress: isTemporaryName ? input.manualAddress ?? null : null,
        manualPhone: isTemporaryName ? input.manualPhone ?? null : null,
        paymentStatus: input.paymentStatus ?? "UNPAID",
        paymentAmount: input.paymentAmount ?? null,
        notes: input.notes ?? null,
        status: event.numberingLocked ? "SUPPLEMENTARY" : "ACTIVE",
      },
    });

    await recordVersion(
      {
        entityType: "PurificationEntry",
        entityId: entry.id,
        action: "CREATE",
        afterData: entry,
        operatorName,
      },
      tx
    );

    return entry;
  });

  return { ok: true, data: { id: created.id, number: created.number! } };
}

/**
 * 更新收款狀態/金額/備註（不允許透過這支修改姓名/性別/生日等應該來自信眾
 * 主資料的欄位）。
 *
 * ⚠️ V11.0.1「全宮共用收款中心」整合：`paymentStatus`/`paymentAmount` 是
 * V9.0 起的舊欄位，繼續保留給既有畫面相容使用，但不再是權威資料。正式的
 * 應收/已收/未收金額改用 `feeStatus`/`amountDue`（已收/未收由
 * src/lib/receivableAdapters.ts 的收款分錄加總維護，這裡不能直接改
 * amountPaid）。`feeStatus`/`amountDue` 是這支函式新增的可選欄位，只有
 * 呼叫端明確帶入時才會更新，不影響既有只用 paymentStatus/paymentAmount
 * 的呼叫方式。
 */
export async function updatePurificationRegistration(
  id: string,
  input: {
    paymentStatus?: PurificationPaymentStatus;
    paymentAmount?: number | null;
    feeStatus?: "UNSET" | "CHARGEABLE" | "WAIVED";
    amountDue?: number | null;
    notes?: string | null;
    manualAddress?: string | null;
    manualPhone?: string | null;
  },
  operatorName?: string | null
): Promise<PurificationResult<{ id: string }>> {
  const existing = await prisma.purificationEntry.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆祭改報名資料" };
  }

  const data: Prisma.PurificationEntryUpdateInput = {};
  if (input.paymentStatus !== undefined) data.paymentStatus = input.paymentStatus;
  if (input.paymentAmount !== undefined) data.paymentAmount = input.paymentAmount;
  if (input.notes !== undefined) data.notes = input.notes;
  if (existing.isTemporaryName) {
    if (input.manualAddress !== undefined) data.manualAddress = input.manualAddress;
    if (input.manualPhone !== undefined) data.manualPhone = input.manualPhone;
  }
  // 需求「祭改未設定、收費、免收」三態切換規則——實際判斷邏輯抽到
  // src/lib/collectionCenterRules.ts 的 resolveFeeStatusUpdate()（純函式，
  // 不依賴 Prisma），這裡只負責把 DB 讀到的既有資料餵進去、把結果寫回
  // Prisma 的 data 物件，兩邊算法只有一份，也才能在沒有 @prisma/client 的
  // 環境下直接用 tsx --test 驗證這個規則本身是否正確。
  if (input.feeStatus !== undefined || (input.amountDue !== undefined && existing.feeStatus === "CHARGEABLE")) {
    const resolved = resolveFeeStatusUpdate({
      feeStatus: input.feeStatus,
      amountDue: input.amountDue,
      existingFeeStatus: existing.feeStatus,
      existingAmountDue: existing.amountDue ? Number(existing.amountDue) : null,
      existingAmountPaid: Number(existing.amountPaid),
    });
    if (!resolved.ok) {
      return { ok: false, status: 400, error: resolved.error };
    }
    if (resolved.feeStatus !== undefined) data.feeStatus = resolved.feeStatus;
    data.amountDue = resolved.amountDue;
    data.amountUnpaid = resolved.amountUnpaid;
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.purificationEntry.update({ where: { id }, data });
    await recordVersion(
      {
        entityType: "PurificationEntry",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: updated,
        operatorName,
      },
      tx
    );
  });

  return { ok: true, data: { id } };
}

/**
 * 取消一筆祭改報名（對應需求「七」：保留原編號、狀態改為取消，不釋出給
 * 後面的人使用、不會讓後面所有人重新編號）。
 */
export async function cancelPurificationRegistration(
  id: string,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string }>> {
  const existing = await prisma.purificationEntry.findUnique({ where: { id } });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: "找不到這筆祭改報名資料" };
  }
  if (existing.status === "CANCELLED") {
    return { ok: false, status: 409, error: "這筆資料已經是取消狀態" };
  }

  await prisma.$transaction(async (tx) => {
    const updated = await tx.purificationEntry.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    await recordVersion(
      {
        entityType: "PurificationEntry",
        entityId: id,
        action: "UPDATE",
        beforeData: existing,
        afterData: updated,
        changeNote: "取消祭改報名（保留原編號）",
        operatorName,
      },
      tx
    );
  });

  return { ok: true, data: { id } };
}

// ============================================================
// 五、重新編號（只有尚未正式列印時，管理者明確二次確認才可執行）
// ============================================================

/**
 * 重新編號整批重排。只有這個年度還沒有任何一筆開始列印（numberingLocked=false）
 * 才允許執行；`confirm` 必須是 true。
 */
export async function renumberPurificationYear(
  purificationYearId: string,
  confirm: boolean,
  operatorName?: string | null
): Promise<PurificationResult<{ reassignedCount: number }>> {
  if (!confirm) {
    return { ok: false, status: 400, error: "重新編號需要明確二次確認" };
  }
  const event = await prisma.templeEvent.findUnique({ where: { id: purificationYearId } });
  if (!event || event.activityType !== "PURIFICATION") {
    return { ok: false, status: 404, error: "找不到這個祭改年度" };
  }
  if (event.numberingLocked) {
    return {
      ok: false,
      status: 409,
      error: "這個年度已經開始列印，編號已鎖定，不能重新編號",
    };
  }

  const reassigned = await prisma.$transaction(async (tx) => {
    const entries = await tx.purificationEntry.findMany({
      where: { templeEventId: purificationYearId, status: { in: ["ACTIVE", "SUPPLEMENTARY"] }, deletedAt: null },
      orderBy: { registeredAt: "asc" },
    });
    const extraBanned = await getExtraBannedNumbers(tx, purificationYearId);
    const numbers = assignSequentialNumbers(entries.length, 0, extraBanned);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const newNumber = numbers[i];
      if (entry.number === newNumber) continue;
      const updated = await tx.purificationEntry.update({
        where: { id: entry.id },
        data: { number: newNumber, status: "ACTIVE" },
      });
      await recordVersion(
        {
          entityType: "PurificationEntry",
          entityId: entry.id,
          action: "UPDATE",
          beforeData: entry,
          afterData: updated,
          changeNote: "重新編號",
          operatorName,
        },
        tx
      );
    }
    return entries.length;
  });

  return { ok: true, data: { reassignedCount: reassigned } };
}

// ============================================================
// 六、禁用編號清單管理（僅供管理者使用，見 src/lib/permissions.ts）
// 這裡管理的是「全域」清單（跨所有年度都生效）；單一活動年度「額外」
// 禁用號碼目前只透過「沿用去年」自動延續，尚未開放畫面個別編輯，見
// 交付說明。
// ============================================================

export async function listBannedNumbers() {
  return prisma.purificationBannedNumber.findMany({ orderBy: { number: "asc" } });
}

export async function addBannedNumber(
  number: number,
  reason: string | null,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string }>> {
  const existing = await prisma.purificationBannedNumber.findUnique({ where: { number } });
  if (existing) {
    return { ok: false, status: 409, error: "這個號碼已經在禁用清單裡" };
  }
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.purificationBannedNumber.create({ data: { number, reason } });
    await recordVersion(
      {
        entityType: "PurificationBannedNumber",
        entityId: row.id,
        action: "CREATE",
        afterData: row,
        operatorName,
      },
      tx
    );
    return row;
  });
  return { ok: true, data: { id: created.id } };
}

export async function removeBannedNumber(
  number: number,
  operatorName?: string | null
): Promise<PurificationResult<{ id: string }>> {
  const existing = await prisma.purificationBannedNumber.findUnique({ where: { number } });
  if (!existing) {
    return { ok: false, status: 404, error: "找不到這個禁用號碼" };
  }
  await prisma.$transaction(async (tx) => {
    await tx.purificationBannedNumber.delete({ where: { number } });
    await recordVersion(
      {
        entityType: "PurificationBannedNumber",
        entityId: existing.id,
        action: "DELETE",
        beforeData: existing,
        operatorName,
      },
      tx
    );
  });
  return { ok: true, data: { id: existing.id } };
}

// ============================================================
// 七、年度總覽（含待確認清單）／列印批次
// ============================================================

export type PurificationYearOverview = {
  id: string;
  year: number;
  name: string;
  isLocked: boolean;
  registrations: PurificationRegistrationView[];
  needsConfirmation: { registration: PurificationRegistrationView; issues: string[] }[];
};

export async function getPurificationYearOverview(
  purificationYearId: string
): Promise<PurificationYearOverview | null> {
  const event = await prisma.templeEvent.findUnique({ where: { id: purificationYearId } });
  if (!event || event.activityType !== "PURIFICATION") return null;

  const entries = await prisma.purificationEntry.findMany({
    where: { templeEventId: purificationYearId, deletedAt: null },
    include: { member: true, ritualRecord: { include: { household: true } } },
    orderBy: [{ number: "asc" }, { registeredAt: "asc" }],
  });

  const extraBanned = await getExtraBannedNumbers(prisma, purificationYearId);
  const numberCounts = new Map<number, number>();
  for (const e of entries) {
    if (e.number !== null) numberCounts.set(e.number, (numberCounts.get(e.number) ?? 0) + 1);
  }

  const views = entries.map((e) => resolvePurificationRegistrationView(e));
  const needsConfirmation: { registration: PurificationRegistrationView; issues: string[] }[] = [];

  views.forEach((view, i) => {
    const entry = entries[i];
    if (entry.status === "CANCELLED") return; // 已取消的資料不需要列入待確認清單
    const isDuplicate = view.number !== null && (numberCounts.get(view.number) ?? 0) > 1;
    const fields = buildPurificationPrintFields(view, event.year, extraBanned, isDuplicate);
    if (!fields.readiness.canPrint) {
      needsConfirmation.push({ registration: view, issues: fields.readiness.issues });
    }
  });

  return {
    id: event.id,
    year: event.year,
    name: event.name,
    isLocked: event.numberingLocked,
    registrations: views,
    needsConfirmation,
  };
}

/**
 * 年度清單。刻意把 TempleEvent 的欄位名稱（numberingLocked/copiedFromEventId）
 * 對應回舊版 PurificationYear 的欄位名稱（isLocked/copiedFromYearId）再回傳，
 * 這樣前端 YearListScreen.tsx／types.ts 的 JSON 形狀完全不用改。
 */
export async function listPurificationYears() {
  const events = await prisma.templeEvent.findMany({
    where: { activityType: "PURIFICATION" },
    orderBy: { year: "desc" },
  });
  return events.map((e) => ({
    id: e.id,
    year: e.year,
    name: e.name,
    isLocked: e.numberingLocked,
    copiedFromYearId: e.copiedFromEventId,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }));
}

// ============================================================
// 八、列印批次（全部／編號範圍／姓名／尚未列印／補印單筆／補印整張）
// ============================================================

export type PrintBatchFilter =
  | { kind: "ALL" }
  | { kind: "UNPRINTED" }
  | { kind: "NUMBER_RANGE"; from: number; to: number }
  | { kind: "NAME"; query: string }
  | { kind: "IDS"; ids: string[] };

export type GeneratedPrintBatch = {
  batchId: string;
  pages: PurificationPrintFields[][];
  totalCount: number;
};

export type PrintPreview = {
  pages: PurificationPrintFields[][];
  totalCount: number;
  blockingCount: number;
};

function buildPrintBatchWhere(templeEventId: string, filter: PrintBatchFilter): Prisma.PurificationEntryWhereInput {
  const where: Prisma.PurificationEntryWhereInput = {
    templeEventId,
    deletedAt: null,
    status: { in: ["ACTIVE", "SUPPLEMENTARY"] },
    number: { not: null },
  };
  if (filter.kind === "UNPRINTED") where.isPrinted = false;
  if (filter.kind === "NUMBER_RANGE") where.number = { gte: filter.from, lte: filter.to };
  if (filter.kind === "NAME") {
    where.OR = [
      { manualDisplayName: { contains: filter.query, mode: "insensitive" } },
      { member: { name: { contains: filter.query, mode: "insensitive" } } },
    ];
  }
  if (filter.kind === "IDS") where.id = { in: filter.ids };
  return where;
}

/** 依篩選條件把報名資料組成列印欄位清單（不含分頁），列印預覽與正式產生批次共用這段邏輯。 */
async function resolvePrintBatchFields(
  templeEventId: string,
  targetYear: number,
  filter: PrintBatchFilter
): Promise<{ entries: EntryWithRelations[]; fieldsList: PurificationPrintFields[] }> {
  const where = buildPrintBatchWhere(templeEventId, filter);

  const entries = await prisma.purificationEntry.findMany({
    where,
    include: { member: true, ritualRecord: { include: { household: true } } },
    orderBy: { number: "asc" },
  });

  const extraBanned = await getExtraBannedNumbers(prisma, templeEventId);
  const numberCounts = new Map<number, number>();
  for (const e of entries) {
    if (e.number !== null) numberCounts.set(e.number, (numberCounts.get(e.number) ?? 0) + 1);
  }

  const fieldsList = entries.map((e) => {
    const view = resolvePurificationRegistrationView(e);
    const isDuplicate = view.number !== null && (numberCounts.get(view.number) ?? 0) > 1;
    return buildPurificationPrintFields(view, targetYear, extraBanned, isDuplicate);
  });

  return { entries, fieldsList };
}

/**
 * 列印前的完整 A4 預覽（需求「十三」）——純查詢，不會標記任何資料為已
 * 列印、不會建立列印批次、不會鎖定年度。
 */
export async function previewPurificationPrintBatch(
  purificationYearId: string,
  filter: PrintBatchFilter
): Promise<PurificationResult<PrintPreview>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: purificationYearId } });
  if (!event || event.activityType !== "PURIFICATION") {
    return { ok: false, status: 404, error: "找不到這個祭改年度" };
  }

  const { fieldsList } = await resolvePrintBatchFields(purificationYearId, event.year, filter);

  if (fieldsList.length === 0) {
    return { ok: false, status: 400, error: "沒有符合條件的資料" };
  }

  const blockingCount = fieldsList.filter((f) => !f.readiness.canPrint).length;
  const pages = paginateForPrinting(fieldsList, 33);

  return { ok: true, data: { pages, totalCount: fieldsList.length, blockingCount } };
}

/**
 * 依篩選條件產生一個列印批次：標記符合條件的報名資料為已列印，建立
 * TempleEventPrintBatch，並把結果依 33 格分頁。這個年度第一次真正執行
 * 列印時，年度會被鎖定（numberingLocked=true），之後「重新編號」就會被
 * 擋下（見 renumberPurificationYear）。
 */
export async function generatePurificationPrintBatch(
  purificationYearId: string,
  filter: PrintBatchFilter,
  operatorName?: string | null,
  note?: string | null
): Promise<PurificationResult<GeneratedPrintBatch>> {
  const event = await prisma.templeEvent.findUnique({ where: { id: purificationYearId } });
  if (!event || event.activityType !== "PURIFICATION") {
    return { ok: false, status: 404, error: "找不到這個祭改年度" };
  }

  const { entries, fieldsList } = await resolvePrintBatchFields(purificationYearId, event.year, filter);

  if (entries.length === 0) {
    return { ok: false, status: 400, error: "沒有符合條件、可以列印的資料" };
  }

  const blocking = fieldsList.filter((f) => !f.readiness.canPrint);
  if (blocking.length > 0) {
    return {
      ok: false,
      status: 400,
      error: `有 ${blocking.length} 筆資料尚未通過列印前檢查（性別/生日/地址/編號等），請先到待確認清單處理，不能直接列印`,
    };
  }

  const batchId = await prisma.$transaction(async (tx) => {
    const batch = await tx.templeEventPrintBatch.create({
      data: {
        templeEventId: purificationYearId,
        registrationCount: entries.length,
        printedByName: operatorName ?? null,
        note: note ?? null,
      },
    });

    if (!event.numberingLocked) {
      await tx.templeEvent.update({ where: { id: purificationYearId }, data: { numberingLocked: true } });
    }

    for (const entry of entries) {
      const updated = await tx.purificationEntry.update({
        where: { id: entry.id },
        data: { isPrinted: true, printedAt: new Date(), printBatchId: batch.id },
      });
      await recordVersion(
        {
          entityType: "PurificationEntry",
          entityId: entry.id,
          action: "UPDATE",
          beforeData: entry,
          afterData: updated,
          changeNote: "列印小人頭貼紙",
          operatorName,
        },
        tx
      );
    }

    return batch.id;
  });

  const pages = paginateForPrinting(fieldsList, 33);

  return { ok: true, data: { batchId, pages, totalCount: entries.length } };
}

export async function listPrintBatches(purificationYearId: string) {
  return prisma.templeEventPrintBatch.findMany({
    where: { templeEventId: purificationYearId },
    orderBy: { createdAt: "desc" },
  });
}
