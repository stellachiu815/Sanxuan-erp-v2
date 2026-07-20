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
  type ActivityYearPrintProfile,
} from "@/lib/zodiacSexagenary";
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
  /** 原始地址 */
  address: string | null;
  /** 已國字化的地址（燈牌／疏文用） */
  addressText: string;

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
  const event = await prisma.templeEvent.findUnique({
    where: { activityType_year: { activityType, year } },
  });
  if (!event) return null;

  // 列印開關檢查（沿用 activityYear 的共用判斷，不另寫一套）
  const candidates = await listActivityYearCandidates(activityType);
  const candidate = candidates.find((c) => c.year === year);
  const printCheck = candidate ? canPrint(candidate) : { ok: false, reason: "找不到活動年度資料" };

  const records = await prisma.ritualRecord.findMany({
    where: { activityType, year, deletedAt: null },
    include: {
      household: { select: { id: true, name: true, address: true } },
      member: true,
    },
    orderBy: [{ householdId: "asc" }, { createdAt: "asc" }],
  });

  const rows: LanternPrintRow[] = [];

  for (const r of records) {
    // 年度燈是「為某一位信眾點燈」，沒有 member 的紀錄無法產生燈牌
    if (!r.member || r.member.deletedAt) continue;
    const m = r.member;

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

    const address = r.household.address;

    rows.push({
      memberId: m.id,
      householdId: r.household.id,
      householdName: r.household.name,
      name: m.name,
      address,
      addressText: printAddress(address),
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
      },
      issues: profile.issues,
      // 指令十一：資料不完整者不得列印，必須先在預檢處理
      canPrint: profile.issues.length === 0,
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
    name: string;
    addressText: string;
    nominalAgeText: string;
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
        name: r.name,
        addressText: r.addressText,
        nominalAgeText: r.text.nominalAgeText,
        zodiacText: r.text.zodiacText,
        jishiText: r.text.jishiText,
        taisuiText: r.text.taisuiText,
      })),
    excluded: batch.rows
      .filter((r) => !r.canPrint)
      .map((r) => ({ name: r.name, issues: r.issues })),
  };
}
