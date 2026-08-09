/**
 * V13.1 指令十一：年度燈的跨年度列印資料。
 *
 * ── 這個模組解決的問題 ─────────────────────────────────────
 * 年度燈通常在**年底受理、隔年度適用**：民國 115 年底開始受理 116 年度
 * 點燈，並可能在農曆年前就先印好燈牌。此時：
 *
 *   電腦日期 = 115 年，尚未過農曆年
 *   但燈牌、疏文、名冊、歲數、生肖、太歲 全部要用 **116 年度**
 *
 * 所以這個模組的每一支函式都**只吃活動年度、完全不讀今天日期**。
 * 這是指令十一「補印、重印、跨多年度仍正確」的實作保證：同一筆資料在
 * 任何一天執行，只要活動年度相同，輸出就完全相同。
 *
 * ── 沿用既有架構 ────────────────────────────────────────
 *   活動年度 → TempleEvent（GUANGMING_LANTERN / TAISUI_LANTERN / FAMILY_LANTERN）
 *   報名紀錄 → RitualRecord（一戶 × 一年 × 一活動類型）
 * 沒有新增任何年度燈專用資料表。
 */

import { prisma } from "@/lib/prisma";
import type { ActivityType } from "@prisma/client";
import {
  buildActivityYearPrintProfile,
  ACTUAL_AGE_MISSING_ISSUE,
  type ActivityYearPrintProfile,
} from "@/lib/zodiacSexagenary";
import { displayPersonalAddress } from "@/lib/personalAddress";
import {
  printAge,
  printAddress,
  printMinguoYear,
  printLunarMonthDay,
} from "@/lib/printChinese";
import { canPrint, listActivityYearCandidates } from "@/lib/activityYear";

/** 三種年度燈的活動類型。 */
export const LANTERN_ACTIVITY_TYPES: ActivityType[] = [
  "GUANGMING_LANTERN",
  "TAISUI_LANTERN",
  "FAMILY_LANTERN",
];

export const LANTERN_TYPE_LABEL: Record<string, string> = {
  GUANGMING_LANTERN: "光明燈",
  TAISUI_LANTERN: "太歲燈",
  FAMILY_LANTERN: "全家燈",
};

/**
 * 一位信眾在某個年度燈活動的完整列印資料。
 *
 * 同時保留**原始值**與**國字化後的文字**：
 *   - 原始值供畫面核對、排序、匯出
 *   - 國字文字供燈牌／疏文列印
 * 指令十二：資料庫保留原始資料，只有列印轉換。
 */
export type LanternPrintRow = {
  memberId: string;
  householdId: string;
  householdName: string;

  /** 原始姓名（不轉換） */
  name: string;
  /** 原始地址（個人優先、空退家戶） */
  address: string | null;
  /** 已國字化的**個人**地址（疏文用；Member.address 優先、空退家戶） */
  addressText: string;
  /** 已國字化的**家戶（主要聯絡人）**地址（全家燈牌用；全家共用一個） */
  householdAddressText: string;

  /** 依活動年度算出的完整屬性 */
  profile: ActivityYearPrintProfile;

  /** 國字化後的列印文字 */
  text: {
    /** 「民國一百一十六年」 */
    activityYearText: string;
    /** 「歲次丁未」 */
    sexagenaryText: string;
    /** 「三十八歲」；歲數無法計算時為空字串 */
    nominalAgeText: string;
    /** 「三十七歲」；實歲無法計算時為空字串 */
    actualAgeText: string;
    /** 生肖，例如「馬」；無資料為空字串 */
    zodiacText: string;
    /** 太歲關係，例如「沖太歲」；不犯或無資料為空字串 */
    taisuiText: string;
    /** 「建生」／「瑞生」；性別空白為空字串（必須先在預檢處理） */
    jishiText: string;
    /** 農曆生日「七月十八日」；無資料為空字串 */
    lunarBirthText: string;
    /** V38 稱謂：「信士」（男）／「信女」（女），供疏文／全家燈牌用；未填性別預設信士 */
    titleText: string;
  };

  /** 待處理事項。非空 → 這一筆不可列印，必須先由使用者處理 */
  issues: string[];
  /** 是否可以列印 */
  canPrint: boolean;
};

export type LanternPrintBatch = {
  activityType: ActivityType;
  activityTypeLabel: string;
  /** 活動使用年度（民國） */
  year: number;
  activityName: string;
  /** 活動日期，作為實歲計算基準；未設定時實歲無法計算 */
  eventDate: Date | null;
  /** 活動是否開放列印 */
  printOpen: boolean;
  printBlockedReason: string | null;

  rows: LanternPrintRow[];
  /** 可直接列印的筆數 */
  readyCount: number;
  /** 需要先處理的筆數 */
  blockedCount: number;
};

/**
 * 建立某個年度燈活動的完整列印批次。
 *
 * @param activityType 年度燈類型
 * @param year **活動使用年度**（民國）。由呼叫端明確傳入——
 *             這支絕不自行用今天日期推年度（指令十一）。
 */
export async function buildLanternPrintBatch(
  activityType: ActivityType,
  year: number
): Promise<LanternPrintBatch | null> {
  // V15R4 年度燈統一：新架構下三種燈掛在**單一 ANNUAL_LANTERN 事件**、每位信眾的點燈
  // 資料在 RitualRegistrationItem（memberId＋項目型別）。列印一律引用信眾／家戶／報名同
  // 一份資料，不建第二套列印資料。事件優先取年度燈（新），找不到才退回舊的 per-type 事件。
  const event =
    (await prisma.templeEvent.findUnique({ where: { activityType_year: { activityType: "ANNUAL_LANTERN", year } } })) ??
    (await prisma.templeEvent.findUnique({ where: { activityType_year: { activityType, year } } }));
  if (!event) return null;

  // 列印開關檢查（沿用 activityYear 的共用判斷，用實際承載這年度燈的事件類型）
  const candidates = await listActivityYearCandidates(event.activityType);
  const candidate = candidates.find((c) => c.year === year);
  const printCheck = candidate ? canPrint(candidate) : { ok: false, reason: "找不到活動年度資料" };

  const LANTERN_ITEM_KEY: Record<string, string> = {
    GUANGMING_LANTERN: "LANTERN_GUANGMING",
    TAISUI_LANTERN: "LANTERN_TAISUI",
    FAMILY_LANTERN: "LANTERN_FAMILY",
  };
  const itemKey = LANTERN_ITEM_KEY[activityType];

  // 取列印對象（信眾＋家戶），以 memberId 去重：
  //  (1) 新／V14 item-based：該燈項目的 RitualRegistrationItem → member ＋ ritualRecord.household。
  //  (2) 舊 per-member：RitualRecord.member（pre-V14 年度燈直接掛在 record 上）。
  const items = itemKey
    ? await prisma.ritualRegistrationItem.findMany({
        where: {
          registrationItemType: { key: itemKey },
          deletedAt: null,
          status: { not: "CANCELLED" },
          memberId: { not: null },
          ritualRecord: { year, deletedAt: null },
        },
        include: {
          member: true,
          ritualRecord: { include: { household: { select: { id: true, name: true, address: true } } } },
        },
      })
    : [];
  const oldRecords = await prisma.ritualRecord.findMany({
    where: { activityType, year, deletedAt: null, memberId: { not: null } },
    include: { household: { select: { id: true, name: true, address: true } }, member: true },
    orderBy: [{ householdId: "asc" }, { createdAt: "asc" }],
  });

  type LanternSubject = {
    member: NonNullable<(typeof oldRecords)[number]["member"]>;
    household: { id: string; name: string; address: string | null };
  };
  const subjects = new Map<string, LanternSubject>();
  for (const it of items) {
    if (!it.member || it.member.deletedAt || !it.ritualRecord.household) continue;
    subjects.set(it.member.id, { member: it.member, household: it.ritualRecord.household });
  }
  for (const r of oldRecords) {
    if (!r.member || r.member.deletedAt || subjects.has(r.member.id)) continue;
    subjects.set(r.member.id, { member: r.member, household: r.household });
  }

  // V39 全家燈：報名以「戶」為單位——燈牌與疏文一律印**當前整戶有效成員**
  // （同一家戶＋未辭世 isDeceased=false＋未刪除 deletedAt=null，沿用 familyLantern 的既有資格條件，
  // 不另發明），不只登記那一位。已辭世者不印、報名後新增的成員下次列印自動出現（＝「現在這一家人」）。
  //
  // ⚠️ 準確性與一致性：燈牌（FamilyLanternCard）與疏文（PetitionSheet）都由這份 subjects→rows 產生，
  //    **單一資料來源**，因此「牌上幾人 = 疏文幾人」由架構保證，不會不一致。
  //    全家燈為「一戶一個固定價」（非按人頭），撈幾位不影響收款／財務。
  if (activityType === "FAMILY_LANTERN") {
    const familyRecs = await prisma.ritualRegistrationItem.findMany({
      where: {
        registrationItemType: { key: "LANTERN_FAMILY" },
        deletedAt: null,
        status: { not: "CANCELLED" },
        ritualRecord: { year, deletedAt: null },
      },
      select: { ritualRecord: { select: { householdId: true } } },
    });
    const householdIds = [...new Set(familyRecs.map((r) => r.ritualRecord.householdId))];
    subjects.clear();
    if (householdIds.length > 0) {
      const familyMembers = await prisma.member.findMany({
        where: { householdId: { in: householdIds }, isDeceased: false, deletedAt: null },
        include: { household: { select: { id: true, name: true, address: true } } },
        orderBy: [{ householdId: "asc" }, { createdAt: "asc" }],
      });
      for (const m of familyMembers) {
        if (!m.household) continue;
        subjects.set(m.id, { member: m, household: m.household });
      }
    }
  }

  const rows: LanternPrintRow[] = [];

  for (const { member: m, household } of subjects.values()) {
    /**
     * ⚠️ 關鍵：這裡傳的是 `year`（活動使用年度），不是今天。
     * 虛歲、生肖、太歲、建生瑞生全部由這個年度決定。
     *
     * 實歲的基準日用**活動日期**（event.solarDate）——年度燈要印的是
     * 「活動當天這個人幾歲」，不是「今天幾歲」。活動日期未設定時
     * 實歲無法計算，會列入 issues 由使用者補齊活動資料。
     */
    const profile = buildActivityYearPrintProfile({
      activityMinguoYear: year,
      birthLunarYearAD: m.lunarBirthYear,
      solarBirthDate: m.solarBirthDate,
      gender: m.gender,
      referenceDate: event.solarDate,
    });

    // 地址準確性（Stella 交代）：
    //  - 疏文＝**個人**地址（Member.address 最高權威；空白才退回家戶地址，見 personalAddress.ts），
    //    因為同一戶不同成員可能各自不同址。
    //  - 全家燈牌＝**家戶（主要聯絡人）**地址（householdAddressText），全家共用一個。
    const personalAddr = displayPersonalAddress(m.address, household.address);

    rows.push({
      memberId: m.id,
      householdId: household.id,
      householdName: household.name,
      name: m.name,
      address: personalAddr,
      addressText: printAddress(personalAddr),
      householdAddressText: printAddress(household.address),
      profile,
      text: {
        activityYearText: `民國${printMinguoYear(year)}年`,
        sexagenaryText: `歲次${profile.activitySexagenary}`,
        nominalAgeText: profile.nominalAge !== null ? printAge(profile.nominalAge) : "",
        actualAgeText: profile.actualAge !== null ? printAge(profile.actualAge) : "",
        zodiacText: profile.zodiac ?? "",
        taisuiText: profile.taisui ?? "",
        jishiText: profile.jishi ?? "",
        lunarBirthText:
          m.lunarBirthMonth !== null && m.lunarBirthDay !== null
            ? printLunarMonthDay(m.lunarBirthMonth, m.lunarBirthDay, m.lunarIsLeapMonth)
            : "",
        titleText: m.gender === "女" ? "信女" : "信士", // 未填/男 → 信士
      },
      issues: profile.issues,
      // 指令十一：資料不完整者不得列印。但「缺實歲（活動日期未設定）」屬**非阻擋性**——
      // 燈牌不印實歲（只印虛歲／生肖／太歲／建生瑞生），不該被它擋下；仍保留在 issues
      // 供核對表柔性提醒。缺姓名／生日／生肖／太歲等會真正影響列印的，才擋。
      canPrint: profile.issues.filter((i) => i !== ACTUAL_AGE_MISSING_ISSUE).length === 0,
    });
  }

  return {
    activityType,
    activityTypeLabel: LANTERN_TYPE_LABEL[activityType] ?? activityType,
    year,
    activityName: event.name,
    eventDate: event.solarDate,
    printOpen: printCheck.ok,
    printBlockedReason: printCheck.ok ? null : printCheck.reason,
    rows,
    readyCount: rows.filter((r) => r.canPrint).length,
    blockedCount: rows.filter((r) => !r.canPrint).length,
  };
}

/**
 * 疏文用的整體資料（一份疏文涵蓋整個活動年度的所有信眾）。
 *
 * 同樣**完全依活動年度**，不讀今天。
 */
export type PetitionData = {
  /** 「民國一百一十六年」 */
  yearText: string;
  /** 「歲次丁未」 */
  sexagenaryText: string;
  activityName: string;
  activityTypeLabel: string;
  /** 農曆活動日期「正月十五日」；未設定時空字串 */
  lunarDateText: string;
  /** 參與信眾（已國字化） */
  entries: {
    /** 稱謂：信士／信女 */
    titleText: string;
    name: string;
    addressText: string;
    nominalAgeText: string;
    /** 農曆生日「七月十八日」 */
    birthText: string;
    zodiacText: string;
    jishiText: string;
    taisuiText: string;
  }[];
  /** 未列入疏文的筆數與原因（資料不完整者不得列印） */
  excluded: { name: string; issues: string[] }[];
};

export async function buildPetitionData(
  activityType: ActivityType,
  year: number
): Promise<PetitionData | null> {
  const batch = await buildLanternPrintBatch(activityType, year);
  if (!batch) return null;

  const event = await prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType, year } },
  });

  const lunarDateText =
    event?.lunarDateMonth != null && event?.lunarDateDay != null
      ? printLunarMonthDay(event.lunarDateMonth, event.lunarDateDay, event.lunarDateIsLeap)
      : "";

  return {
    yearText: `民國${printMinguoYear(year)}年`,
    sexagenaryText: batch.rows[0]?.text.sexagenaryText ?? "",
    activityName: batch.activityName,
    activityTypeLabel: batch.activityTypeLabel,
    lunarDateText,
    entries: batch.rows
      .filter((r) => r.canPrint)
      .map((r) => ({
        titleText: r.text.titleText,
        name: r.name,
        addressText: r.addressText,
        nominalAgeText: r.text.nominalAgeText,
        birthText: r.text.lunarBirthText,
        zodiacText: r.text.zodiacText,
        jishiText: r.text.jishiText,
        taisuiText: r.text.taisuiText,
      })),
    excluded: batch.rows
      .filter((r) => !r.canPrint)
      .map((r) => ({ name: r.name, issues: r.issues })),
  };
}
