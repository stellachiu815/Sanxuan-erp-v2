import type { ActivityType } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { deriveBirthdayInfo, formatLunarDate, formatSolarDate } from "@/lib/lunar";

export type MemberRoleValue =
  | "HOUSEHOLD_HEAD"
  | "SPOUSE"
  | "SON"
  | "DAUGHTER"
  | "FATHER"
  | "MOTHER"
  | "GRANDFATHER"
  | "GRANDMOTHER"
  | "OTHER";

export type MemberView = {
  id: string;
  name: string;
  gender: string | null;
  role: MemberRoleValue;
  isPrimaryContact: boolean;
  isDeceased: boolean;
  yangshangName: string | null;
  notes: string | null;
  solarBirthDateText: string | null;
  lunarBirthDateText: string | null;
  zodiac: string | null;
  actualAge: number | null;
  nominalAge: number | null;
};

export type HouseholdView = {
  id: string;
  name: string;
  contactName: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  companyName: string | null;
  notes: string | null;
  members: MemberView[];
  worshipRecords: {
    id: string;
    type: "ANCESTOR_LINE" | "INDIVIDUAL";
    displayName: string;
    location: string | null;
    yangshangName: string | null;
    notes: string | null;
  }[];
  activities: {
    id: string;
    type: ActivityType;
    year: number | null;
    note: string | null;
    createdAt: Date;
    /**
     * V12.3「家戶管理完整強化」指令一.B：這筆紀錄原本屬於哪一戶。
     *
     * null＝就是本戶自己的紀錄；有值＝來自已合併進本戶的來源家戶。
     * 純家戶層級的歷史（Activity／RitualRecord）在合併時**刻意不改寫**
     * householdId——一來要保留歷史發生當下的原始家戶，二來 RitualRecord 有
     * @@unique([householdId, year, activityType])，直接搬移會唯一鍵衝突。
     * 所以改成查詢時合併，並在畫面標示「原家戶」，避免使用者誤以為這些紀錄
     * 是合併之後才產生的。
     */
    originHouseholdId: string | null;
    originHouseholdName: string | null;
  }[];
  /** V12.3：已經合併進本戶的來源家戶清單（供畫面說明歷史資料來源）。 */
  mergedFromHouseholds: { id: string; name: string; mergedAt: Date | null }[];
};

/**
 * 取得完整家戶資料（供家戶頁與 API route 共用，計算邏輯只寫一次）。
 */
export async function getHouseholdDetail(id: string): Promise<HouseholdView | null> {
  const household = await prisma.household.findFirst({
    // V8.0「刪除保護」：家戶本身若已被移入回收區（目前系統尚未開放刪除
    // 家戶的功能，見 src/lib/recycleBin.ts 的說明，這裡先預留一致的行為），
    // 一律視為「找不到」；成員也只撈未被移入回收區的。
    where: { id, deletedAt: null },
    include: {
      members: { where: { deletedAt: null }, orderBy: { createdAt: "asc" } },
      worshipRecords: { orderBy: { createdAt: "asc" } },
      activities: { orderBy: { createdAt: "desc" } },
    },
  });

  if (!household) return null;

  /**
   * V12.3 指令一.B：把「已合併進本戶的來源家戶」的家戶層級歷史一併查出來。
   *
   * 只往下找一層就夠——合併時來源戶自己原有的別名會一併改指向目標戶
   * （見 householdManagement.mergeHouseholds），而且已合併的家戶不可再被
   * 當成合併目標（assertHouseholdNotMerged），所以不會出現多層鏈或循環。
   */
  const mergedSources = await prisma.household.findMany({
    where: { mergedIntoHouseholdId: household.id },
    select: { id: true, name: true, mergedAt: true },
    orderBy: { mergedAt: "asc" },
  });

  const mergedSourceActivities =
    mergedSources.length > 0
      ? await prisma.activity.findMany({
          where: { householdId: { in: mergedSources.map((h) => h.id) } },
          orderBy: { createdAt: "desc" },
        })
      : [];

  const sourceNameById = new Map(mergedSources.map((h) => [h.id, h.name]));

  const members: MemberView[] = household.members.map((m) => {
    const birthday = deriveBirthdayInfo({
      solarBirthDate: m.solarBirthDate,
      lunarBirthYear: m.lunarBirthYear,
      lunarBirthMonth: m.lunarBirthMonth,
      lunarBirthDay: m.lunarBirthDay,
      lunarIsLeapMonth: m.lunarIsLeapMonth,
    });

    return {
      id: m.id,
      name: m.name,
      gender: m.gender,
      role: m.role as MemberRoleValue,
      isPrimaryContact: m.isPrimaryContact,
      isDeceased: m.isDeceased,
      yangshangName: m.yangshangName,
      notes: m.notes,
      solarBirthDateText: birthday ? formatSolarDate(birthday.solarDate) : null,
      lunarBirthDateText: birthday ? formatLunarDate(birthday.lunar) : null,
      zodiac: birthday?.zodiac ?? null,
      actualAge: birthday?.actualAge ?? null,
      nominalAge: birthday?.nominalAge ?? null,
    };
  });

  return {
    id: household.id,
    name: household.name,
    contactName: household.contactName,
    phone: household.phone,
    mobile: household.mobile,
    address: household.address,
    companyName: household.companyName,
    notes: household.notes,
    members,
    worshipRecords: household.worshipRecords,
    // 本戶自己的活動 ＋ 已合併來源戶的活動，依時間合併排序；來源戶的標上原家戶。
    activities: [
      ...household.activities.map((a) => ({
        ...a,
        originHouseholdId: null,
        originHouseholdName: null,
      })),
      ...mergedSourceActivities.map((a) => ({
        ...a,
        originHouseholdId: a.householdId,
        originHouseholdName: sourceNameById.get(a.householdId) ?? null,
      })),
    ].sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime()),
    mergedFromHouseholds: mergedSources,
  };
}
