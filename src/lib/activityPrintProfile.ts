import { safeDeriveBirthdayInfo } from "@/lib/lunar";
import {
  buildActivityYearPrintProfile,
  type ActivityYearPrintProfile,
} from "@/lib/zodiacSexagenary";
import { printLunarMonthDay, printMinguoYear, printAge } from "@/lib/printChinese";
import { adToMinguo } from "@/lib/minguoDate";

/**
 * V13.4 指令二／九：**全系統活動列印的唯一生日與歲數來源。**
 *
 * ── 固定規則（適用所有現在與未來的活動列印）────────────────
 *   1. 一律使用**農曆生日**，不得列印國曆生日
 *   2. 歲數一律依**活動使用年度**計算，不得用系統目前日期
 *   3. 年底提前列印隔年活動時，自動使用隔年度的虛歲（不會少算一歲）
 *   4. 生肖、太歲、建生瑞生同樣依活動年度
 *
 * 適用：普渡牌位與名冊、祭改貼紙與名冊、光明燈、太歲燈、全家燈、疏文、
 * 宮慶／神明聖誕名冊，以及任何需要顯示生日或歲數的列印。
 *
 * ── 為什麼要包一層 ───────────────────────────────────────
 * `zodiacSexagenary.buildActivityYearPrintProfile()` 是零相依純函式
 * （不 import lunar-javascript），它算得出虛歲、生肖、太歲，但**算不出
 * 農曆生日本身**——那需要農曆換算套件。
 *
 * 這一支負責把兩者接起來：先用 `lunar.ts` 把生日換算成農曆，再交給
 * 純函式算年度屬性，最後補上國字格式。各活動模組一律呼叫這裡，
 * **不得自行呼叫 lunar／zodiacSexagenary 各算一份**。
 */

export type ActivityPrintProfile = ActivityYearPrintProfile & {
  /** 農曆生日（西元年）。資料不足為 null */
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;

  /** 「農曆一百一十四年七月十八日」——國字格式，列印直接用 */
  lunarBirthText: string;
  /** 「三十八歲」——依活動年度的虛歲，國字格式 */
  nominalAgeText: string;
  /** 「民國一百一十六年」 */
  activityYearText: string;
  /** 「歲次丁未」 */
  sexagenaryText: string;
};

export type ActivityPrintProfileInput = {
  /** 活動使用年度（民國）。**必填，且絕不使用今天的年份** */
  activityMinguoYear: number;
  /** 信眾國曆生日 */
  solarBirthDate: Date | null | undefined;
  /** 信眾既有的農曆生日欄位（有值時優先，代表當初是用農曆登記的） */
  lunarBirthYear: number | null | undefined;
  lunarBirthMonth: number | null | undefined;
  lunarBirthDay: number | null | undefined;
  lunarIsLeapMonth: boolean | null | undefined;
  /** 性別（決定建生／瑞生） */
  gender: string | null | undefined;
  /** 實歲的基準日，通常是活動日期。null 時實歲無法計算 */
  referenceDate: Date | null | undefined;
};

/**
 * 產生一位信眾在指定活動年度的完整列印屬性。
 *
 * ⚠️ 完全不讀取今天日期來決定年度。同一筆資料在任何一天呼叫，
 * 只要 activityMinguoYear 相同，結果就完全相同——這是補印、重印、
 * 跨多年度都正確的保證。
 */
export function buildActivityPrintProfile(
  input: ActivityPrintProfileInput
): ActivityPrintProfile {
  /**
   * 先取得農曆生日。
   * safeDeriveBirthdayInfo 會自行處理「只有國曆」「只有農曆」「兩者都有」
   * 三種情況，並對任何異常資料回傳 null（不丟例外、不產生 NaN）。
   */
  const birthday = safeDeriveBirthdayInfo({
    solarBirthDate: input.solarBirthDate ?? null,
    lunarBirthYear: input.lunarBirthYear ?? null,
    lunarBirthMonth: input.lunarBirthMonth ?? null,
    lunarBirthDay: input.lunarBirthDay ?? null,
    lunarIsLeapMonth: input.lunarIsLeapMonth ?? false,
  });

  const lunarBirthYear = birthday ? birthday.lunar.year : null;
  const lunarBirthMonth = birthday ? birthday.lunar.month : null;
  const lunarBirthDay = birthday ? birthday.lunar.day : null;
  const lunarIsLeapMonth = birthday ? Boolean(birthday.lunar.isLeapMonth) : false;

  const base = buildActivityYearPrintProfile({
    activityMinguoYear: input.activityMinguoYear,
    // ⚠️ 傳農曆年，不是國曆年——虛歲與生肖都以農曆年為準
    birthLunarYearAD: lunarBirthYear,
    solarBirthDate: birthday ? birthday.solarDate : null,
    gender: input.gender,
    referenceDate: input.referenceDate ?? null,
  });

  // 國字格式：農曆生日
  let lunarBirthText = "";
  if (lunarBirthYear !== null && lunarBirthMonth !== null && lunarBirthDay !== null) {
    const minguo = adToMinguo(lunarBirthYear);
    // 民國元年之前的農曆年不轉民國（避免出現負數年）
    const yearText = minguo >= 1 ? `農曆民國${printMinguoYear(minguo)}年` : "農曆";
    lunarBirthText = `${yearText}${printLunarMonthDay(lunarBirthMonth, lunarBirthDay, lunarIsLeapMonth)}`;
  }

  return {
    ...base,
    lunarBirthYear,
    lunarBirthMonth,
    lunarBirthDay,
    lunarIsLeapMonth,
    lunarBirthText,
    nominalAgeText: base.nominalAge !== null ? printAge(base.nominalAge) : "",
    activityYearText: `民國${printMinguoYear(input.activityMinguoYear)}年`,
    sexagenaryText: `歲次${base.activitySexagenary}`,
  };
}

/**
 * 從一筆 Member 直接產生列印屬性（最常用的入口）。
 *
 * @param activityMinguoYear **活動使用年度**，不是今年
 * @param eventDate 活動日期（實歲基準）；沒有就傳 null
 */
export function buildActivityPrintProfileForMember(
  member: {
    solarBirthDate: Date | null;
    lunarBirthYear: number | null;
    lunarBirthMonth: number | null;
    lunarBirthDay: number | null;
    lunarIsLeapMonth: boolean;
    gender: string | null;
  },
  activityMinguoYear: number,
  eventDate: Date | null
): ActivityPrintProfile {
  return buildActivityPrintProfile({
    activityMinguoYear,
    solarBirthDate: member.solarBirthDate,
    lunarBirthYear: member.lunarBirthYear,
    lunarBirthMonth: member.lunarBirthMonth,
    lunarBirthDay: member.lunarBirthDay,
    lunarIsLeapMonth: member.lunarIsLeapMonth,
    gender: member.gender,
    referenceDate: eventDate,
  });
}

/**
 * V13.4：把列印 profile 轉成要存進 RitualParticipant 的快照欄位。
 *
 * 確認報名時呼叫一次，之後列印一律讀快照——信眾日後改生日、搬家、
 * 轉戶都不會改變已確認年度的列印內容（指令三、十一）。
 */
export type ParticipantPrintSnapshot = {
  lunarBirthYearSnapshot: number | null;
  lunarBirthMonthSnapshot: number | null;
  lunarBirthDaySnapshot: number | null;
  lunarIsLeapMonthSnapshot: boolean;
  nominalAgeSnapshot: number | null;
  zodiacSnapshot: string | null;
  taisuiSnapshot: string | null;
  printProfileSnapshotAt: Date;
};

export function toParticipantSnapshot(
  profile: ActivityPrintProfile,
  now: Date = new Date()
): ParticipantPrintSnapshot {
  return {
    lunarBirthYearSnapshot: profile.lunarBirthYear,
    lunarBirthMonthSnapshot: profile.lunarBirthMonth,
    lunarBirthDaySnapshot: profile.lunarBirthDay,
    lunarIsLeapMonthSnapshot: profile.lunarIsLeapMonth,
    nominalAgeSnapshot: profile.nominalAge,
    zodiacSnapshot: profile.zodiac,
    taisuiSnapshot: profile.taisui,
    printProfileSnapshotAt: now,
  };
}

/**
 * 從已保存的快照還原列印文字（列印時使用，不重新計算）。
 *
 * ⚠️ 這是「已確認報名」的列印路徑：一律讀快照，不碰 Member。
 * 快照為 null（舊資料或尚未確認）時回傳空字串，由呼叫端顯示「待補」。
 */
export function renderSnapshotTexts(snapshot: {
  lunarBirthYearSnapshot: number | null;
  lunarBirthMonthSnapshot: number | null;
  lunarBirthDaySnapshot: number | null;
  lunarIsLeapMonthSnapshot: boolean;
  nominalAgeSnapshot: number | null;
}): { lunarBirthText: string; nominalAgeText: string } {
  const { lunarBirthYearSnapshot: y, lunarBirthMonthSnapshot: m, lunarBirthDaySnapshot: d } = snapshot;

  let lunarBirthText = "";
  if (y !== null && m !== null && d !== null) {
    const minguo = adToMinguo(y);
    const yearText = minguo >= 1 ? `農曆民國${printMinguoYear(minguo)}年` : "農曆";
    lunarBirthText = `${yearText}${printLunarMonthDay(m, d, snapshot.lunarIsLeapMonthSnapshot)}`;
  }

  return {
    lunarBirthText,
    nominalAgeText:
      snapshot.nominalAgeSnapshot !== null ? printAge(snapshot.nominalAgeSnapshot) : "",
  };
}
