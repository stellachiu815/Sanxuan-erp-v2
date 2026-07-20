import { Prisma, type Member, type Household, type MemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * V12「信眾資料中心正式建置」指令「四、信眾完整資料編輯頁」。
 *
 * 這支檔案負責的是「基本資料」——直接寫回既有的 Member／Household 兩張表，
 * 跟 src/lib/devoteeProfile.ts 的 updateDevoteeProfile()（只改 DevoteeProfile
 * 延伸資料表）是兩件不同的事，刻意分成兩個檔案、兩支函式，不要混在一起，
 * 原因：
 * 1. 修改對象是完全不同的資料表（Member／Household vs DevoteeProfile），
 *    合併成一支函式會讓「這個欄位到底存在哪裡」變得不清楚。
 * 2. DevoteeProfile 是「延遲建立」的延伸資料（見 devoteeProfile.ts 說明），
 *    Member／Household 則是既有、一定存在的既有資料，不需要 getOrCreate。
 *
 * ⚠️ 家戶編號（Household.id）本輪明確不開放修改（使用者已確認）：
 * Household.id 是主鍵，被 Member／WorshipRecord／Activity／RitualRecord／
 * PaymentTransaction／Receipt 等十幾張表引用，且都沒有設定 onUpdate
 * cascade，直接修改會造成外鍵衝突或需要高風險的多表同步更新。這裡刻意
 * 不提供修改 Household.id 的任何路徑。
 */

export type BirthdayEditInput =
  | { type: "solar"; solarBirthDate: Date }
  | {
      type: "lunar";
      lunarBirthYear: number;
      lunarBirthMonth: number;
      lunarBirthDay: number;
      lunarIsLeapMonth: boolean;
    }
  | { type: "none" };

export type UpdateDevoteeBaseInput = {
  // 信眾基本資料（Member）
  name?: string;
  gender?: string | null;
  role?: MemberRole;
  isPrimaryContact?: boolean;
  isDeceased?: boolean;
  deceasedAt?: Date | null;
  yangshangName?: string | null;
  notes?: string | null;
  birthHour?: string | null;
  birthday?: BirthdayEditInput;

  // 家戶資料（Household）——刻意不包含 id，見上方說明。
  household?: {
    name?: string;
    contactName?: string | null;
    address?: string | null;
    phone?: string | null;
  };
};

export type UpdateDevoteeBaseResult = {
  member: Member;
  household: Household | null; // null 代表這次呼叫沒有修改家戶資料
};

export async function updateDevoteeBase(
  memberId: string,
  input: UpdateDevoteeBaseInput,
  operatorName: string | null
): Promise<UpdateDevoteeBaseResult> {
  const existingMember = await prisma.member.findUnique({ where: { id: memberId } });
  if (!existingMember || existingMember.deletedAt) {
    throw new Error("找不到這位信眾（家戶成員），無法修改資料");
  }

  const memberData: Prisma.MemberUpdateInput = {};
  if (input.name !== undefined) memberData.name = input.name;
  if (input.gender !== undefined) memberData.gender = input.gender;
  if (input.role !== undefined) memberData.role = input.role;
  if (input.isPrimaryContact !== undefined) memberData.isPrimaryContact = input.isPrimaryContact;
  if (input.isDeceased !== undefined) memberData.isDeceased = input.isDeceased;
  if (input.deceasedAt !== undefined) memberData.deceasedAt = input.deceasedAt;
  if (input.yangshangName !== undefined) memberData.yangshangName = input.yangshangName;
  if (input.notes !== undefined) memberData.notes = input.notes;
  if (input.birthHour !== undefined) memberData.birthHour = input.birthHour;

  if (input.birthday) {
    if (input.birthday.type === "solar") {
      memberData.solarBirthDate = input.birthday.solarBirthDate;
      memberData.lunarBirthYear = null;
      memberData.lunarBirthMonth = null;
      memberData.lunarBirthDay = null;
      memberData.lunarIsLeapMonth = false;
    } else if (input.birthday.type === "lunar") {
      memberData.solarBirthDate = null;
      memberData.lunarBirthYear = input.birthday.lunarBirthYear;
      memberData.lunarBirthMonth = input.birthday.lunarBirthMonth;
      memberData.lunarBirthDay = input.birthday.lunarBirthDay;
      memberData.lunarIsLeapMonth = input.birthday.lunarIsLeapMonth;
    } else {
      memberData.solarBirthDate = null;
      memberData.lunarBirthYear = null;
      memberData.lunarBirthMonth = null;
      memberData.lunarBirthDay = null;
      memberData.lunarIsLeapMonth = false;
    }
  }

  const householdData: Prisma.HouseholdUpdateInput = {};
  if (input.household) {
    if (input.household.name !== undefined) householdData.name = input.household.name;
    if (input.household.contactName !== undefined) householdData.contactName = input.household.contactName;
    if (input.household.address !== undefined) householdData.address = input.household.address;
    if (input.household.phone !== undefined) householdData.phone = input.household.phone;
  }

  return prisma.$transaction(async (tx) => {
    let member = existingMember;
    if (Object.keys(memberData).length > 0) {
      member = await tx.member.update({ where: { id: memberId }, data: memberData });
      await recordVersion(
        {
          entityType: "Member",
          entityId: memberId,
          action: "UPDATE",
          beforeData: existingMember,
          afterData: member,
          operatorName,
          changeNote: "信眾資料中心：修改信眾基本資料",
        },
        tx
      );
    }

    let household: Household | null = null;
    if (Object.keys(householdData).length > 0) {
      const existingHousehold = await tx.household.findUnique({ where: { id: existingMember.householdId } });
      household = await tx.household.update({ where: { id: existingMember.householdId }, data: householdData });
      await recordVersion(
        {
          entityType: "Household",
          entityId: existingMember.householdId,
          action: "UPDATE",
          beforeData: existingHousehold,
          afterData: household,
          operatorName,
          changeNote: "信眾資料中心：修改家戶資料（經由信眾完整資料編輯頁）",
        },
        tx
      );
    }

    return { member, household };
  });
}
