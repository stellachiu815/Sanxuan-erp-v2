import { ActivityType, Prisma, RitualRecordStatus, UniversalSalvationEntryCategory } from "@prisma/client";
import { prisma, type DbClient } from "@/lib/prisma";
import { universalSalvationEntryCategoryLabel } from "@/lib/labels";
import { recordVersion } from "@/lib/recordVersion";
import { ensureTabletPrintObjects } from "@/lib/additionalPrintItems";
import { resolveYangshangNames, formatYangshangAcclaim } from "@/lib/yangshang";
import { ensureLinkedTabletItem, cancelLinkedTabletItem } from "@/lib/registrationItemRegistration";

/**
 * V2.0「祭祀資料核心」的業務邏輯統一寫在這裡（route.ts 只負責解析請求/回傳，
 * 邏輯集中在 lib，方便未來普渡以外的模組——年度燈、宮慶——共用同一套模式）。
 */

// 列印時四個類別固定的顯示順序。刻意直接標註成 Prisma 產生的
// UniversalSalvationEntryCategory[]（而不是從 labels.ts 的 Record<string,
// string> 用 keyof 推導），避免型別被寬鬆成 string 導致 build 失敗
// （2026-07-15 部署時實際遇到這個錯誤，已修正）。
const ENTRY_CATEGORY_ORDER: UniversalSalvationEntryCategory[] = [
  "ANCESTOR_LINE",
  "INDIVIDUAL_SOUL",
  "DEBT_CREDITOR",
  "UNBORN_CHILD",
];

/**
 * 目前的祭祀年度（民國年），以伺服器目前時間為準。
 * V3.0「普渡登記 UI」用這個決定「今年」是哪一年，不需要行政人員自己輸入。
 */
export function getCurrentRitualYear(now: Date = new Date()): number {
  return now.getFullYear() - 1911;
}

/**
 * 今年／去年／前年（民國年，V5.1「年度快照」新增），供未來「快速切換
 * 年度」UI 使用。固定回傳 3 個年度、由新到舊，不管這幾個年度有沒有實際
 * 祭祀資料都會列出（因為「今年」很可能還沒開始登記）。
 */
export function getRecentRitualYears(now: Date = new Date()): number[] {
  const currentYear = getCurrentRitualYear(now);
  return [currentYear, currentYear - 1, currentYear - 2];
}

// 一筆普渡登記主檔 + 明細 + 登記項目，撈出來時固定用這個 include 形狀
//
// V8.0「刪除保護」：entries 只撈 deletedAt: null 的，移入回收區的登記項目
// 不會出現在正常畫面/查詢/列印裡（但資料本身還在，只是被過濾掉）。
const universalSalvationInclude = {
  universalSalvation: {
    include: {
      entries: {
        where: { deletedAt: null },
        orderBy: [{ category: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
        // V13.1 指令七：牌位地址存在 WorshipRecord.location。普渡登記項目
        // 若有關聯回牌位（worshipRecordId），列印時要一併帶出牌位地址。
        // 沒有關聯的項目（例如冤親債主、無緣子女直接手動輸入）則沒有地址，
        // 模板會自動略過該區塊，不會印出空白框。
        include: { worshipRecord: { select: { location: true } } },
      },
    },
  },
} satisfies Prisma.RitualRecordInclude;

export type UniversalSalvationRecordView = Prisma.RitualRecordGetPayload<{
  include: typeof universalSalvationInclude;
}>;

/** 取得某戶、某年度的普渡登記完整資料（主檔＋明細＋登記項目）。找不到回傳 null。
 *  V8.0：整筆主檔如果已經被移入回收區（deletedAt 有值），一律視為「找不到」，
 *  只有從回收區還原後才會重新出現在這支查詢裡。 */
export async function getUniversalSalvationRecord(
  householdId: string,
  year: number,
  db?: DbClient
): Promise<UniversalSalvationRecordView | null> {
  return (db ?? prisma).ritualRecord.findFirst({
    where: {
      householdId,
      year,
      activityType: "UNIVERSAL_SALVATION",
      deletedAt: null,
    },
    include: universalSalvationInclude,
  });
}

export type CopyUniversalSalvationResult =
  | { ok: true; record: UniversalSalvationRecordView }
  | { ok: false; status: number; error: string };

/**
 * 「複製去年資料」：把來源年度（預設是目標年度的前一年）的普渡登記整組
 * （主檔＋明細＋所有登記項目）複製成新的一筆，來源那筆完全不受影響。
 *
 * 設計上的兩個預設值（若未來實際使用上不符合需求，麻煩再跟我們確認調整）：
 * 1. 目標年度如果已經有資料，不會覆蓋，直接回傳錯誤——「彼此互不覆蓋」。
 * 2. 複製後的新一筆，狀態固定重設為 DRAFT、「是否報名普渡」重設為 false，
 *    因為換了新年度，需要重新確認/報名，不會因為複製就直接視為已確認。
 *    其餘欄位（陽上姓名、安奉位置、贊普、普渡桌、備註、所有登記項目）原樣複製，
 *    當作今年資料輸入的起點。
 */
/**
 * V13.4：沿用去年的可選項目。
 *
 * ⚠️ 固定規則（不可設定、一律不複製）：
 *   付款紀錄／已付款狀態／收據號碼與開立狀態／對帳與代收繳回狀態／
 *   交易 ID／列印完成狀態／列印次數／已列印時間／列印批次／
 *   作廢與核銷狀態／舊年度主鍵與活動關聯／建立與修改人
 *
 * 新年度一律建立全新的主檔與子資料，財務與作業狀態全部初始化。
 */
export type CarryOverOptions = {
  /** 四類牌位（名稱／陽上人／排序／worshipRecordId） */
  copyEntries?: boolean;
  /** 贊普設定（數量／單價／金額）。⚠️ 不含付款狀態 */
  copySponsor?: boolean;
  /** 備註 */
  copyNotes?: boolean;
  /**
   * 普渡桌號。
   * ⚠️ **預設不沿用**——桌號屬於年度作業資料，每年重新安排。
   * 只有使用者明確勾選確認時才帶入。
   */
  copyTableNumber?: boolean;
  operatorName?: string | null;
};

export async function copyUniversalSalvationFromPreviousYear(
  householdId: string,
  targetYear: number,
  sourceYearOrOptions?: number | CarryOverOptions,
  maybeOptions?: CarryOverOptions
): Promise<CopyUniversalSalvationResult> {
  // 相容既有呼叫端（householdId, targetYear, sourceYear?）
  const sourceYear =
    typeof sourceYearOrOptions === "number" ? sourceYearOrOptions : undefined;
  const options: CarryOverOptions =
    (typeof sourceYearOrOptions === "object" ? sourceYearOrOptions : maybeOptions) ?? {};
  const copyEntries = options.copyEntries !== false;
  const copySponsor = options.copySponsor !== false;
  const copyNotes = options.copyNotes !== false;
  const copyTableNumber = options.copyTableNumber === true;
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    return { ok: false, status: 404, error: "找不到這個家戶" };
  }

  const fromYear = sourceYear ?? targetYear - 1;

  const existingTarget = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year: targetYear,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
  });
  if (existingTarget) {
    // V8.0「刪除保護」：唯一鍵不分軟刪除與否都會佔用，所以要區分「已存在
    // 且還在使用中」跟「已經被移入回收區」兩種情況，給不同的提示訊息。
    if (existingTarget.deletedAt) {
      return {
        ok: false,
        status: 409,
        error: `${targetYear} 年的普渡資料已經被移入回收區，請先從回收區還原，不能直接建立新的一筆`,
      };
    }
    return {
      ok: false,
      status: 409,
      error: `${targetYear} 年的普渡資料已經存在，不會覆蓋既有資料`,
    };
  }

  const source = await getUniversalSalvationRecord(householdId, fromYear);
  if (!source || !source.universalSalvation) {
    return { ok: false, status: 404, error: `找不到 ${fromYear} 年的普渡資料，無法複製` };
  }

  const universalSalvation = source.universalSalvation;

  // V8.0：建立資料與寫入版本紀錄放在同一個資料庫交易（transaction）裡，
  // 確保「資料真的建立了」跟「留下版本紀錄」不會只成功一半。
  const created = await prisma.$transaction(async (tx) => {
    const record = await tx.ritualRecord.create({
      data: {
        householdId,
        // V13.4 修正：不再複製 deprecated 的 memberId——報名成員改由
        // RitualParticipant 記錄，由呼叫端在 copy 之後補上。
        year: targetYear,
        activityType: "UNIVERSAL_SALVATION",
        // 沿用建立的一律是草稿，內容確認後才 CONFIRMED
        status: "DRAFT",
        registrationSource: "CARRY_OVER",
        copiedFromRitualRecordId: source.id,
        notes: copyNotes ? source.notes : null,
        universalSalvation: {
          create: {
            isRegistered: false,
            yangshangName: universalSalvation.yangshangName,
            enshrinementLocation: universalSalvation.enshrinementLocation,

            // ── 贊普設定（可選）──
            isSponsor: copySponsor ? universalSalvation.isSponsor : false,
            sponsorQuantity: copySponsor ? universalSalvation.sponsorQuantity : null,
            sponsorUnitPrice: copySponsor ? universalSalvation.sponsorUnitPrice : null,
            sponsorAmount: copySponsor ? universalSalvation.sponsorAmount : null,
            sponsorNotes: copySponsor ? universalSalvation.sponsorNotes : null,

            /**
             * V13.4 修正：amountDue 必須依本年度沿用的贊普金額**重新計算**。
             *
             * 舊版只複製 sponsorAmount，amountDue 用預設 0——結果贊普顯示
             * 800 元、應收卻是 0，收款中心完全看不到這筆。
             *
             * amountPaid / amountUnpaid 一律初始化：去年的付款絕不帶過來。
             */
            amountDue:
              copySponsor && universalSalvation.isSponsor
                ? (universalSalvation.sponsorAmount ?? 0)
                : 0,
            amountPaid: 0,
            amountUnpaid:
              copySponsor && universalSalvation.isSponsor
                ? (universalSalvation.sponsorAmount ?? 0)
                : 0,

            /**
             * V13.4 修正：桌號**預設不沿用**。
             * 桌號是年度作業資料，每年重新安排；只有使用者明確勾選才帶入。
             */
            tableNumber: copyTableNumber ? universalSalvation.tableNumber : null,

            notes: copyNotes ? universalSalvation.notes : null,
            entries: copyEntries
              ? {
                  create: universalSalvation.entries.map((entry) => ({
                    category: entry.category,
                    displayName: entry.displayName,
                    yangshangName: entry.yangshangName,
                    // V14.4 Part 6A：多位陽上人與每筆牌位地址可安全沿用（純內容，非財務/列印）。
                    yangshangNames: entry.yangshangNames ?? [],
                    tabletAddress: entry.tabletAddress ?? null,
                    /**
                     * worshipRecordId 可安全沿用：WorshipRecord 沒有 year 欄位，
                     * 是**跨年度共用的牌位母資料**（歷代祖先／乙位正魂），
                     * 不是年度報名資料。
                     */
                    worshipRecordId: entry.worshipRecordId,
                    sortOrder: entry.sortOrder,
                    notes: copyNotes ? entry.notes : null,
                    // ⚠️ 一律不沿用任何列印時間／列印次數／操作人與財務狀態欄位；
                    // 收款、帳本、白米舊單價/總斤/超額核准也不帶入（見下方共用
                    // ensureTabletPrintObjects 一律建立「未列印」的預設物件；白米改由
                    // 新年度重新認購）。
                  })),
                }
              : undefined,
          },
        },
      },
      include: universalSalvationInclude,
    });

    // V14.4 Part 6A（方案 A）：每一筆沿用建立的草稿牌位，一律共用
    // ensureLinkedTabletItem（DRAFT 計價項目，未 CONFIRMED 不進待收）＋
    // ensureTabletPrintObjects（預設 TABLET／POCKET，printCount=0、無列印紀錄）。
    // 不帶入任何去年列印時間/次數/操作人/收款/帳本；白米不沿用，改由新年度重新認購。
    const copiedEntries = record.universalSalvation?.entries ?? [];
    for (const e of copiedEntries) {
      await ensureLinkedTabletItem(tx, {
        ritualRecordId: record.id,
        entryId: e.id,
        category: e.category,
        year: targetYear,
        status: "DRAFT",
        memberId: null,
      });
      await ensureTabletPrintObjects(
        {
          ritualRecordId: record.id,
          householdId,
          sourceEntryId: e.id,
          printName: e.displayName,
          memberId: null,
          activityId: record.templeEventId ?? null,
        },
        tx
      );
    }

    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: record.id,
        action: "CREATE",
        afterData: record,
        changeNote: `由 ${fromYear} 年複製建立`,
      },
      tx
    );

    return record;
  });

  return { ok: true, record: created };
}

export type CreateBlankUniversalSalvationResult =
  | { ok: true; record: UniversalSalvationRecordView }
  | { ok: false; status: number; error: string };

/**
 * 建立一筆全新、空白的普渡登記（不複製任何資料，明細各欄位都是空的）。
 *
 * V3.0「普渡登記 UI」用在使用者回答「今年跟去年不一樣」時，直接從空白
 * 開始登記，而不是複製去年資料。目標年度已有資料時回傳 409，不會覆蓋。
 */
export async function createBlankUniversalSalvationRecord(
  householdId: string,
  year: number,
  db?: DbClient
): Promise<CreateBlankUniversalSalvationResult> {
  const client = db ?? prisma;
  const household = await client.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    return { ok: false, status: 404, error: "找不到這個家戶" };
  }

  const existing = await client.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
  });
  if (existing) {
    // V8.0「刪除保護」：同上，區分「已存在」跟「已經被移入回收區」。
    if (existing.deletedAt) {
      return {
        ok: false,
        status: 409,
        error: `${year} 年的普渡資料已經被移入回收區，請先從回收區還原，不能直接建立新的一筆`,
      };
    }
    return {
      ok: false,
      status: 409,
      error: `${year} 年的普渡資料已經存在，不會覆蓋既有資料`,
    };
  }

  const runBlank = async (tx: DbClient) => {
    const record = await tx.ritualRecord.create({
      data: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
        status: "DRAFT",
        registrationSource: "HOUSEHOLD_PAGE",
        universalSalvation: {
          create: {
            isRegistered: false,
          },
        },
      },
      include: universalSalvationInclude,
    });

    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: record.id,
        action: "CREATE",
        afterData: record,
      },
      tx
    );

    return record;
  };
  const created = db ? await runBlank(db) : await prisma.$transaction(runBlank);

  return { ok: true, record: created };
}

export type UpdateUniversalSalvationDetailInput = {
  isRegistered?: boolean;
  yangshangName?: string | null;
  enshrinementLocation?: string | null;
  isSponsor?: boolean;
  sponsorQuantity?: number | null;
  sponsorUnitPrice?: number | null;
  sponsorAmount?: number | null;
  sponsorNotes?: string | null;
  tableNumber?: string | null;
  notes?: string | null;
};

export type UpdateUniversalSalvationDetailResult =
  | { ok: true; record: UniversalSalvationRecordView }
  | { ok: false; status: number; error: string };

/** 更新普渡登記明細（陽上姓名／安奉位置／贊普/普渡桌/備註/是否報名）。
 *  V8.0：更新前後的完整快照會寫入一筆 RecordVersion，供「修改紀錄」查看/
 *  回復使用；operatorName 是自由文字（系統目前沒有登入功能，見
 *  src/lib/recordVersion.ts 開頭的說明）。 */
export async function updateUniversalSalvationDetail(
  householdId: string,
  year: number,
  input: UpdateUniversalSalvationDetailInput,
  operatorName?: string | null
): Promise<UpdateUniversalSalvationDetailResult> {
  const existing = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
    include: { universalSalvation: true },
  });
  if (!existing || !existing.universalSalvation || existing.deletedAt) {
    return { ok: false, status: 404, error: `找不到 ${year} 年的普渡資料` };
  }

  // 刻意不用 `...(cond && {...})` 這種條件式 spread 寫法——之前 V2.0 部署時
  // 已經因為另一種型別寫法（keyof typeof 寬鬆成 string）踩過一次型別陷阱，
  // 這裡改用最直白的「先宣告空物件、逐一 if 判斷賦值」寫法，跟這個專案裡
  // household PATCH route 的寫法一致，也比較不容易在沒有 tsc 可用的環境下
  // 埋下編譯期才會現形的錯誤。
  const data: Prisma.UniversalSalvationDetailUpdateInput = {};
  if (input.isRegistered !== undefined) data.isRegistered = input.isRegistered;
  if (input.yangshangName !== undefined) data.yangshangName = input.yangshangName;
  if (input.enshrinementLocation !== undefined)
    data.enshrinementLocation = input.enshrinementLocation;
  if (input.isSponsor !== undefined) data.isSponsor = input.isSponsor;
  if (input.sponsorQuantity !== undefined) data.sponsorQuantity = input.sponsorQuantity;
  if (input.sponsorUnitPrice !== undefined) data.sponsorUnitPrice = input.sponsorUnitPrice;
  if (input.sponsorAmount !== undefined) data.sponsorAmount = input.sponsorAmount;
  if (input.sponsorNotes !== undefined) data.sponsorNotes = input.sponsorNotes;
  if (input.tableNumber !== undefined) data.tableNumber = input.tableNumber;
  if (input.notes !== undefined) data.notes = input.notes;

  const before = existing.universalSalvation;

  // V11.0.1「全宮共用收款中心」整合：isSponsor／sponsorAmount 有異動時，
  // 同步更新 amountDue／amountUnpaid（贊普的正式應收金額），但絕對不動
  // amountPaid——已收金額只能由 src/lib/receivableAdapters.ts 的收款分錄
  // 邏輯維護，這裡只負責「應收多少」這一半的計算。
  const nextIsSponsor = input.isSponsor ?? before.isSponsor;
  const nextSponsorAmount = input.sponsorAmount !== undefined ? input.sponsorAmount : before.sponsorAmount;
  if (input.isSponsor !== undefined || input.sponsorAmount !== undefined) {
    const amountDue = nextIsSponsor ? Number(nextSponsorAmount ?? 0) : 0;
    data.amountDue = amountDue;
    data.amountUnpaid = Math.max(0, amountDue - Number(before.amountPaid));
  }

  await prisma.$transaction(async (tx) => {
    const after = await tx.universalSalvationDetail.update({
      where: { id: before.id },
      data,
    });

    await recordVersion(
      {
        entityType: "UniversalSalvationDetail",
        entityId: after.id,
        action: "UPDATE",
        beforeData: before,
        afterData: after,
        operatorName,
      },
      tx
    );
  });

  const record = await getUniversalSalvationRecord(householdId, year);
  return { ok: true, record: record! };
}

export type EntryMutationResult =
  | { ok: true; record: UniversalSalvationRecordView }
  | { ok: false; status: number; error: string };

export type CreateUniversalSalvationEntryInput = {
  category: UniversalSalvationEntryCategory;
  displayName: string;
  yangshangName?: string | null;
  /** V14.1：多位陽上人（只存姓名、保留順序）。呼叫端負責清理。 */
  yangshangNames?: string[];
  /** V14.1：此筆牌位自己的地址。 */
  tabletAddress?: string | null;
  notes?: string | null;
  /** V14.2：連動建立之計價項目要掛哪位成員（全戶冤親每位帶入該成員；一般牌位為 null）。 */
  linkedItemMemberId?: string | null;
};

/** 在指定分類（歷代祖先／個人乙位正魂／冤親債主／無緣子女）新增一筆登記項目。 */
export async function createUniversalSalvationEntry(
  householdId: string,
  year: number,
  input: CreateUniversalSalvationEntryInput,
  operatorName?: string | null,
  db?: DbClient
): Promise<EntryMutationResult> {
  const client = db ?? prisma;
  const existing = await client.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
    include: { universalSalvation: { include: { entries: { where: { deletedAt: null } } } } },
  });
  if (!existing || !existing.universalSalvation || existing.deletedAt) {
    return { ok: false, status: 404, error: `找不到 ${year} 年的普渡資料` };
  }

  const sameCategory = existing.universalSalvation.entries.filter(
    (e) => e.category === input.category
  );
  const nextSortOrder =
    sameCategory.length > 0 ? Math.max(...sameCategory.map((e) => e.sortOrder)) + 1 : 1;

  const universalSalvationId = existing.universalSalvation.id;
  const run = async (tx: DbClient) => {
    const created = await tx.universalSalvationEntry.create({
      data: {
        universalSalvationId,
        category: input.category,
        displayName: input.displayName,
        // 舊欄位保留：以首位陽上人同步 yangshangName，讓未升級的讀取路徑仍看得到名字。
        yangshangName: input.yangshangNames && input.yangshangNames.length > 0
          ? input.yangshangNames[0]
          : input.yangshangName ?? null,
        yangshangNames: input.yangshangNames ?? [],
        tabletAddress: input.tabletAddress ?? null,
        notes: input.notes ?? null,
        sortOrder: nextSortOrder,
      },
    });

    await recordVersion(
      {
        entityType: "UniversalSalvationEntry",
        entityId: created.id,
        action: "CREATE",
        afterData: created,
        operatorName,
      },
      tx
    );

    // V14.2：牌位與其計價項目正式 1:1 關聯——建立牌位時連動建立已計價的
    // RitualRegistrationItem 並連結，讓收款／統計／查詢都認得這筆牌位。
    await ensureLinkedTabletItem(tx, {
      ritualRecordId: existing.id,
      entryId: created.id,
      category: input.category,
      year,
      status: existing.status,
      memberId: input.linkedItemMemberId ?? null,
    });

    // V14.4 Part 2：牌位建立時自動建立列印物件（TABLET×1、預設 POCKET×1），
    // 兩者共用同一 entry（不複製姓名/陽上人/地址），冪等防重（同 tx）。
    await ensureTabletPrintObjects(
      {
        ritualRecordId: existing.id,
        householdId,
        sourceEntryId: created.id,
        printName: input.displayName,
        memberId: input.linkedItemMemberId ?? null,
        activityId: existing.templeEventId ?? null,
      },
      tx
    );
  };
  // 有外部 tx → 納入呼叫端交易（Excel 匯入單列整批 rollback）；否則自開交易（原行為）。
  if (db) await run(db);
  else await prisma.$transaction(run);

  const record = await getUniversalSalvationRecord(householdId, year, db);
  return { ok: true, record: record! };
}

export type UpdateUniversalSalvationEntryInput = {
  displayName?: string;
  yangshangName?: string | null;
  /** V14.1：多位陽上人（呼叫端已清理）。傳入即整組覆蓋。 */
  yangshangNames?: string[];
  /** V14.1：此筆牌位地址（null 可清空）。 */
  tabletAddress?: string | null;
  notes?: string | null;
};

/** 修改單一筆登記項目（名稱／陽上姓名／備註）。entryId 不屬於這筆年度資料時回傳 404。 */
export async function updateUniversalSalvationEntry(
  householdId: string,
  year: number,
  entryId: string,
  input: UpdateUniversalSalvationEntryInput,
  operatorName?: string | null
): Promise<EntryMutationResult> {
  const existing = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
    include: { universalSalvation: { include: { entries: { where: { deletedAt: null } } } } },
  });
  if (!existing || !existing.universalSalvation || existing.deletedAt) {
    return { ok: false, status: 404, error: `找不到 ${year} 年的普渡資料` };
  }

  const entry = existing.universalSalvation.entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, status: 404, error: "找不到這筆登記項目" };
  }

  const data: Prisma.UniversalSalvationEntryUpdateInput = {};
  if (input.displayName !== undefined) data.displayName = input.displayName;
  if (input.yangshangName !== undefined) data.yangshangName = input.yangshangName;
  if (input.yangshangNames !== undefined) {
    data.yangshangNames = input.yangshangNames;
    // 同步舊欄位為首位，維持未升級讀取路徑相容（首位為空則清為 null）。
    data.yangshangName = input.yangshangNames.length > 0 ? input.yangshangNames[0] : null;
  }
  if (input.tabletAddress !== undefined) data.tabletAddress = input.tabletAddress;
  if (input.notes !== undefined) data.notes = input.notes;

  await prisma.$transaction(async (tx) => {
    const after = await tx.universalSalvationEntry.update({
      where: { id: entryId },
      data,
    });

    await recordVersion(
      {
        entityType: "UniversalSalvationEntry",
        entityId: entryId,
        action: "UPDATE",
        beforeData: entry,
        afterData: after,
        operatorName,
      },
      tx
    );
  });

  const record = await getUniversalSalvationRecord(householdId, year);
  return { ok: true, record: record! };
}

/**
 * 刪除單一筆登記項目。entryId 不屬於這筆年度資料時回傳 404。
 *
 * V8.0「刪除保護」：這裡不再是真正的 SQL DELETE，而是設定 deletedAt/
 * deletedByName（軟刪除），移入回收區，至少保留 30 天，管理者可以在回收區
 * 還原；只有超過保留期限才可以在回收區裡執行永久刪除
 * （見 src/lib/recycleBin.ts）。
 */
export async function deleteUniversalSalvationEntry(
  householdId: string,
  year: number,
  entryId: string,
  operatorName?: string | null
): Promise<EntryMutationResult> {
  const existing = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
    include: { universalSalvation: { include: { entries: { where: { deletedAt: null } } } } },
  });
  if (!existing || !existing.universalSalvation || existing.deletedAt) {
    return { ok: false, status: 404, error: `找不到 ${year} 年的普渡資料` };
  }

  const entry = existing.universalSalvation.entries.find((e) => e.id === entryId);
  if (!entry) {
    return { ok: false, status: 404, error: "找不到這筆登記項目" };
  }

  await prisma.$transaction(async (tx) => {
    await tx.universalSalvationEntry.update({
      where: { id: entryId },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });

    // V14.2：牌位刪除時，連動取消其計價項目（未收款才取消，已收款保留歷史）。
    await cancelLinkedTabletItem(tx, entryId, operatorName);

    await recordVersion(
      {
        entityType: "UniversalSalvationEntry",
        entityId: entryId,
        action: "DELETE",
        beforeData: entry,
        operatorName,
      },
      tx
    );
  });

  const record = await getUniversalSalvationRecord(householdId, year);
  return { ok: true, record: record! };
}

export type DeleteUniversalSalvationResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/**
 * 刪除某戶、某年度的普渡登記（主檔，連同明細與所有登記項目一起移入回收區）。
 *
 * V8.0「刪除保護」：這裡不再是真正的 SQL DELETE，而是設定 RitualRecord 自己
 * 的 deletedAt/deletedByName（軟刪除）——明細（UniversalSalvationDetail）
 * 跟登記項目本身不需要另外標記，因為所有查詢都是先找「未被軟刪除的
 * RitualRecord」才往下讀明細，父層被移入回收區，底下的資料自然一起「隱形」，
 * 還原時也是同一個動作就整組一起恢復。至少保留 30 天，管理者可以在回收區
 * 還原；只有超過保留期限才可以在回收區裡執行永久刪除
 * （見 src/lib/recycleBin.ts）。這裡不會動到 Household／Member。
 */
export async function deleteUniversalSalvationRecord(
  householdId: string,
  year: number,
  operatorName?: string | null
): Promise<DeleteUniversalSalvationResult> {
  const existing = await prisma.ritualRecord.findUnique({
    where: {
      householdId_year_activityType: {
        householdId,
        year,
        activityType: "UNIVERSAL_SALVATION",
      },
    },
  });
  if (!existing || existing.deletedAt) {
    return { ok: false, status: 404, error: `找不到 ${year} 年的普渡資料` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.ritualRecord.update({
      where: { id: existing.id },
      data: { deletedAt: new Date(), deletedByName: operatorName?.trim() || null },
    });

    await recordVersion(
      {
        entityType: "RitualRecord",
        entityId: existing.id,
        action: "DELETE",
        beforeData: existing,
        operatorName,
      },
      tx
    );
  });

  return { ok: true };
}

export type UniversalSalvationPrintEntry = {
  displayName: string;
  yangshangName: string | null;
  /** V14.1：多位陽上人（相容舊 yangshangName）。 */
  yangshangNames: string[];
  /** V14.1：列印組字「A、B、C叩薦」；無人時空字串。 */
  yangshangAcclaim: string;
  notes: string | null;
  /**
   * V13.1 指令七：牌位地址（來自關聯的 WorshipRecord.location）。
   * 沒有關聯牌位、或牌位地址待補時為 null——列印模板會略過地址區塊。
   *
   * ⚠️ 這裡存的是**原始值**（阿拉伯數字）。國字轉換一律在列印模板端由
   * toPrintableTablet() 處理，不在這裡先轉——資料庫與 API 保留原始資料，
   * 只有列印輸出才轉換（指令十二）。
   */
  location: string | null;
};

export type UniversalSalvationPrintData = {
  household: { id: string; name: string };
  year: number;
  yangshangName: string | null;
  enshrinementLocation: string | null;
  isSponsor: boolean;
  sponsorQuantity: number | null;
  sponsorUnitPrice: Prisma.Decimal | null;
  sponsorAmount: Prisma.Decimal | null;
  sponsorNotes: string | null;
  tableNumber: string | null;
  categories: {
    category: UniversalSalvationEntryCategory;
    categoryLabel: string;
    entries: UniversalSalvationPrintEntry[];
  }[];
};

/**
 * 建立列印用的資料格式（本次只需要資料格式，不產生 PDF）。
 * 依固定順序（歷代祖先 → 個人乙位正魂 → 冤親債主 → 無緣子女）把登記項目分類。
 */
export async function getUniversalSalvationPrintData(
  householdId: string,
  year: number
): Promise<UniversalSalvationPrintData | null> {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) return null;

  const record = await getUniversalSalvationRecord(householdId, year);
  if (!record || !record.universalSalvation) return null;

  const detail = record.universalSalvation;
  const entriesByCategory = new Map<UniversalSalvationEntryCategory, UniversalSalvationPrintEntry[]>();
  for (const entry of detail.entries) {
    const list = entriesByCategory.get(entry.category) ?? [];
    const names = resolveYangshangNames(entry.yangshangNames, entry.yangshangName);
    list.push({
      displayName: entry.displayName,
      yangshangName: entry.yangshangName,
      yangshangNames: names,
      yangshangAcclaim: formatYangshangAcclaim(names),
      notes: entry.notes,
      // 每筆牌位地址優先用自己的 tabletAddress，空值才回退共用 WorshipRecord 地址。
      location: entry.tabletAddress ?? entry.worshipRecord?.location ?? null,
    });
    entriesByCategory.set(entry.category, list);
  }

  return {
    household: { id: household.id, name: household.name },
    year,
    yangshangName: detail.yangshangName,
    enshrinementLocation: detail.enshrinementLocation,
    isSponsor: detail.isSponsor,
    sponsorQuantity: detail.sponsorQuantity,
    sponsorUnitPrice: detail.sponsorUnitPrice,
    sponsorAmount: detail.sponsorAmount,
    sponsorNotes: detail.sponsorNotes,
    tableNumber: detail.tableNumber,
    categories: ENTRY_CATEGORY_ORDER.map((category) => ({
      category,
      categoryLabel: universalSalvationEntryCategoryLabel[category],
      entries: entriesByCategory.get(category) ?? [],
    })),
  };
}

// ============================================================
// V5.1「年度快照（Year Snapshot）」：這一輪不新增資料表、不改 Schema——
// 「每一年都是獨立資料、互不覆蓋」這件事，從 V2.0 建立 RitualRecord 時就已經
// 是這樣設計了（householdId + year + activityType 三者的唯一組合鍵，見
// schema.prisma 的 @@unique([householdId, year, activityType])；上面每一支
// 修改/刪除函式也都固定先用這三個鍵重新查一次才動作，不會影響其他年度）。
// 這一輪要做的是把「年度」本身變成一個可以查詢的維度，讓之後的畫面可以：
// 1. 列出某戶所有「已經有資料」的年度（歷史年度瀏覽）
// 2. 快速取得「今年/去年/前年」（不管有沒有資料，快速切換用）
// 3. 用一支 API 一次看到某年度「所有」祭祀活動類型的資料（年度快照），
//    不用因為以後多了年度燈、宮慶，就要分別打好幾支 API 才能拼出一整年的
//    狀況——之後這兩個模組的明細資料模型做好後，只需要在
//    getRitualYearSnapshot 裡各加一段查詢，不用改這支 API 的網址或既有欄位。
// ============================================================

export type RitualYearsOverview = {
  household: { id: string; name: string };
  /** 今年（民國年），以伺服器目前時間為準。 */
  currentRitualYear: number;
  /** 今年／去年／前年，不管有沒有資料都列出，供「快速切換」使用。 */
  recentYears: number[];
  /** 所有「已經有祭祀資料」的年度，由新到舊，供「歷史年度瀏覽」下拉選單使用。 */
  years: {
    year: number;
    activities: { activityType: ActivityType; status: RitualRecordStatus }[];
  }[];
};

export type RitualYearsOverviewResult =
  | { ok: true; overview: RitualYearsOverview }
  | { ok: false; status: number; error: string };

/**
 * 年度總覽（V5.1 新增）：只查詢、不修改任何資料。
 *
 * 直接用 householdId 撈這一戶「所有年度、所有活動類型」的 RitualRecord——
 * 因為普渡/年度燈/宮慶都共用同一張表，未來只要年度燈或宮慶開始寫入資料，
 * 這支不用改就會自動一起列出來。
 */
export async function getRitualYearsOverview(
  householdId: string
): Promise<RitualYearsOverviewResult> {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    return { ok: false, status: 404, error: "找不到這個家戶" };
  }

  const records = await prisma.ritualRecord.findMany({
    where: { householdId, deletedAt: null },
    select: { year: true, activityType: true, status: true },
    orderBy: [{ year: "desc" }, { activityType: "asc" }],
  });

  const byYear = new Map<number, { activityType: ActivityType; status: RitualRecordStatus }[]>();
  for (const r of records) {
    const list = byYear.get(r.year) ?? [];
    list.push({ activityType: r.activityType, status: r.status });
    byYear.set(r.year, list);
  }

  const years = Array.from(byYear.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([year, activities]) => ({ year, activities }));

  return {
    ok: true,
    overview: {
      household: { id: household.id, name: household.name },
      currentRitualYear: getCurrentRitualYear(),
      recentYears: getRecentRitualYears(),
      years,
    },
  };
}

export type RitualYearSnapshot = {
  household: { id: string; name: string };
  year: number;
  activities: {
    UNIVERSAL_SALVATION: UniversalSalvationRecordView | null;
    // 年度燈、宮慶尚未開發明細資料模型，固定回傳 null；之後這兩個模組做好後，
    // 只需要在 getRitualYearSnapshot 裡各補一段查詢，欄位名稱先保留在這裡，
    // 讓 API 形狀提早穩定下來。
    ANNUAL_LANTERN: null;
    TEMPLE_CELEBRATION: null;
    REPRINT: null;
  };
};

export type RitualYearSnapshotResult =
  | { ok: true; snapshot: RitualYearSnapshot }
  | { ok: false; status: number; error: string };

/**
 * 年度快照（V5.1 新增）：某戶、某年度「所有」祭祀活動類型的資料，一次撈出來。
 *
 * 只查詢、不修改任何資料，固定用 (householdId, year) 篩選——這個年度以外
 * 的 RitualRecord 完全不會被讀到或動到，符合「任何修改只影響目前年度」的
 * 設計（這支本身也不是修改用的 API）。
 */
export async function getRitualYearSnapshot(
  householdId: string,
  year: number
): Promise<RitualYearSnapshotResult> {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
  });
  if (!household) {
    return { ok: false, status: 404, error: "找不到這個家戶" };
  }

  const universalSalvation = await getUniversalSalvationRecord(householdId, year);

  return {
    ok: true,
    snapshot: {
      household: { id: household.id, name: household.name },
      year,
      activities: {
        UNIVERSAL_SALVATION: universalSalvation,
        ANNUAL_LANTERN: null,
        TEMPLE_CELEBRATION: null,
        REPRINT: null,
      },
    },
  };
}
