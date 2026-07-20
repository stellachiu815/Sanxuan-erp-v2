import { Prisma, type Member, type Household, type MemberRole } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";
import { resolveBirthdayFields } from "@/lib/birthdaySync";
import { normalizeNationalId, validateNationalId } from "@/lib/nationalId";

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
  /**
   * V13.1 指令一：身分證字號。
   * undefined = 這次不修改；null = 明確清空；字串 = 設定新值。
   * 只有實際輸入時才驗證格式（空字串視為 null，不驗證）。
   */
  nationalId?: string | null;

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
  /**
   * V13.1 指令四／五：這次儲存是否讓信眾**第一次**由「在世」變成「已辭世」。
   *
   * 只有 true 時，前端才會跳出「是否建立乙位正魂？」的詢問。
   * 判定條件全部成立才會是 true：
   *   1. 這次確實把 isDeceased 由 false 改成 true
   *   2. 這位信眾還沒有乙位正魂（WorshipRecord type=INDIVIDUAL）
   *   3. 使用者過去沒有按過「暫不處理」（soulTabletPromptedAt 為 null）
   *
   * 一般編輯（例如只改備註）一律是 false，不會反覆彈出。
   */
  justMarkedDeceased: boolean;
  /** 若已有乙位正魂，一併回傳 id，讓畫面可以直接提供「查看既有資料」 */
  existingSoulTabletId: string | null;
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

  // V13.1 指令一：身分證字號。只有實際輸入時才驗證格式——既有正式資料裡
  // 可能有格式不正確的舊值，不能因此讓整筆資料存不進去。
  if (input.nationalId !== undefined) {
    const normalized = normalizeNationalId(input.nationalId);
    if (normalized !== null) {
      const check = validateNationalId(normalized);
      if (!check.ok) throw new Error(check.reason);
    }
    memberData.nationalId = normalized;
  }

  /**
   * V13.1 指令二：國曆與農曆生日**兩者都要永久保存**。
   *
   * ⚠️ 這裡是相對 V13.1 之前的行為改變，必須說清楚：
   * 舊版是「選國曆就把農曆四欄清成 null」「選農曆就把國曆清成 null」，
   * 資料庫裡永遠只有一半。V13.1 起改為由 resolveBirthdayFields() 自動
   * 換算另一半，兩邊同時寫入。
   *
   * type === "none" 時仍然是五欄全部清空——那是使用者明確表示「沒有生日
   * 資料」，不是換算失敗，也不會補任何預設值（指令二.6、二.7）。
   */
  if (input.birthday) {
    const resolved = resolveBirthdayFields(
      input.birthday.type === "solar"
        ? { birthdayType: "solar", solarBirthDate: input.birthday.solarBirthDate }
        : input.birthday.type === "lunar"
          ? {
              birthdayType: "lunar",
              lunarBirthYear: input.birthday.lunarBirthYear,
              lunarBirthMonth: input.birthday.lunarBirthMonth,
              lunarBirthDay: input.birthday.lunarBirthDay,
              lunarIsLeapMonth: input.birthday.lunarIsLeapMonth,
            }
          : { birthdayType: "none" }
    );
    if (!resolved.ok) throw new Error(resolved.error);

    memberData.solarBirthDate = resolved.fields.solarBirthDate;
    memberData.lunarBirthYear = resolved.fields.lunarBirthYear;
    memberData.lunarBirthMonth = resolved.fields.lunarBirthMonth;
    memberData.lunarBirthDay = resolved.fields.lunarBirthDay;
    memberData.lunarIsLeapMonth = resolved.fields.lunarIsLeapMonth;
  }

  const householdData: Prisma.HouseholdUpdateInput = {};
  if (input.household) {
    if (input.household.name !== undefined) householdData.name = input.household.name;
    if (input.household.contactName !== undefined) householdData.contactName = input.household.contactName;
    if (input.household.address !== undefined) householdData.address = input.household.address;
    if (input.household.phone !== undefined) householdData.phone = input.household.phone;
  }

  /**
   * V13.1 指令四／五：偵測「在世 → 已辭世」的**首次**轉換。
   *
   * 三個條件必須同時成立才會觸發詢問：
   *   1. 這次確實是由 false 改成 true（不是本來就已辭世、也不是取消辭世）
   *   2. 這位信眾還沒有乙位正魂
   *   3. 使用者過去沒有按過「暫不處理」
   *
   * 第 3 點就是為什麼 V13.1 要新增 Member.soulTabletPromptedAt：
   * 只看「有沒有乙位正魂」無法區分「還沒建立」與「已決定不建立」，
   * 會導致選了暫不處理的信眾每次編輯都被再問一次（指令五明令禁止）。
   */
  const isTransitioningToDeceased =
    input.isDeceased === true && existingMember.isDeceased === false;

  const existingSoulTablet = await prisma.worshipRecord.findFirst({
    where: { memberId, type: "INDIVIDUAL" },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  const justMarkedDeceased =
    isTransitioningToDeceased &&
    existingSoulTablet === null &&
    existingMember.soulTabletPromptedAt === null;

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

    return {
      member,
      household,
      justMarkedDeceased,
      existingSoulTabletId: existingSoulTablet?.id ?? null,
    };
  });
}

/**
 * V13.1 指令五：記錄使用者按下「暫不處理」。
 *
 * 之後一般編輯就不會再自動詢問是否建立乙位正魂。信眾詳情頁仍然常駐
 * 「建立乙位正魂」按鈕，使用者隨時可以手動建立——這個標記只影響
 * **自動詢問**，不封鎖任何操作。
 */
export async function markSoulTabletPrompted(memberId: string): Promise<void> {
  await prisma.member.update({
    where: { id: memberId },
    data: { soulTabletPromptedAt: new Date() },
  });
}

/**
 * V13.1 指令五：取消「已辭世」時，**不得自動刪除**任何既有資料
 * （乙位正魂、歷代祖先、中元普渡、列印或收款紀錄）。
 *
 * 這支只回報「取消辭世後，這些資料仍然存在」，供畫面提示使用者
 * ——如需刪除必須由使用者明確操作。
 *
 * 刻意做成一支明確的查詢函式，而不是在 updateDevoteeBase 裡偷偷處理：
 * 讓「我們不刪東西」這件事在程式碼上看得見。
 */
export async function listRetainedDataAfterUndoDeceased(memberId: string): Promise<string[]> {
  const retained: string[] = [];

  const soulTablets = await prisma.worshipRecord.count({
    where: { memberId, type: "INDIVIDUAL" },
  });
  if (soulTablets > 0) retained.push(`乙位正魂 ${soulTablets} 筆`);

  const salvationEntries = await prisma.universalSalvationEntry.count({
    where: { worshipRecord: { memberId }, deletedAt: null },
  });
  if (salvationEntries > 0) retained.push(`中元普渡登記 ${salvationEntries} 筆`);

  const rituals = await prisma.ritualRecord.count({
    where: { memberId, deletedAt: null },
  });
  if (rituals > 0) retained.push(`祭祀紀錄 ${rituals} 筆`);

  return retained;
}
