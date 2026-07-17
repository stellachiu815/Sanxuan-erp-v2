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
    type: "ANNUAL_LANTERN" | "UNIVERSAL_SALVATION" | "TEMPLE_CELEBRATION" | "REPRINT" | "OTHER";
    year: number | null;
    note: string | null;
    createdAt: Date;
  }[];
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
    address: household.address,
    companyName: household.companyName,
    notes: household.notes,
    members,
    worshipRecords: household.worshipRecords,
    activities: household.activities,
  };
}
