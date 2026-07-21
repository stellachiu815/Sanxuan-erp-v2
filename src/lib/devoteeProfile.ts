import { prisma } from "@/lib/prisma";
import { recordVersion, toJsonSnapshot } from "@/lib/recordVersion";
import { safeDeriveBirthdayInfo, formatLunarDate } from "@/lib/lunar";
import type { Member, DevoteeProfile } from "@prisma/client";

/**
 * V12.0「信眾關係中心」核心邏輯——信眾基本資料組裝與延伸資料維護。
 *
 * 【最重要的設計原則，貫穿整個信眾關係中心】
 * 「信眾」＝既有的 Member（家戶成員），不是另一套獨立名單（對應指令
 * 「三」「八」）。這裡的 DevoteeProfile 只補充 Member 原本沒有的欄位
 * （手機/LINE/Email/個人公司/個人備註/停用/關懷狀態），姓名/性別/身份/
 * 生日/生肖/是否往生一律直接讀 Member，不重複儲存。
 *
 * 【延遲建立 DevoteeProfile，不批次預先建立】
 * 對應指令「三、不得大量複製舊資料至新資料表」——getOrCreateDevoteeProfile()
 * 只有在真的需要寫入（新增互動紀錄/套用標籤/修改延伸資料）時才會第一次
 * 建立一筆 DevoteeProfile。單純「查看」名單/360 總覽時，沒有 DevoteeProfile
 * 的信眾一律用 composeDevoteeSummary() 補上預設值（null/false/[]），
 * 不會為了顯示而觸發建立。
 */

export type DevoteeSummary = {
  memberId: string;
  householdId: string;
  name: string;
  gender: string | null;
  role: string;
  isPrimaryContact: boolean;
  solarBirthDate: string | null; // ISO date string，null 表示沒有登記
  lunarBirthDisplay: string | null; // 例如「農曆 1990 年 三月 初五」，沒有農曆資料則為 null
  lunarBirthYear: number | null; // V12 新增：原始農曆年（欄位層級，供編輯表單直接帶入，跟上面的組合顯示字串分開）
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean; // V12 新增：是否閏月（欄位層級原始值，供編輯表單使用）
  birthHour: string | null; // V12 新增：出生時辰（BirthHour enum 值，例如 "ZI"）

  // ────────────────────────────────────────────────────────────
  // V13.1 生日／生肖模組：以下三欄全部由 deriveBirthdayInfo() 依生日
  // **即時計算**，資料庫不儲存（也不該儲存——生肖與生日綁定不會變，
  // 但歲數每年都會變，存進資料庫必然過期）。
  //
  // 沒有任何有效生日資料時三者皆為 null，畫面顯示「未填寫」。
  // 絕不會是 NaN——deriveBirthdayInfo() 在資料不足時整個回傳 null，
  // 不會回傳一個帶有 NaN 欄位的物件。
  // ────────────────────────────────────────────────────────────

  /** 生肖，例如「馬」。依農曆年計算 */
  zodiac: string | null;
  /** 實歲（周歲）：依國曆生日與**今天**計算，尚未過生日則少一歲 */
  actualAge: number | null;
  /**
   * 虛歲：目前農曆年 − 出生農曆年 + 1。
   *
   * ⚠️ 這是三玄宮 ERP 既有的農曆邏輯（src/lib/lunar.ts 的 getNominalAge），
   * **不是「實歲加一」**。農曆正月初一一過，換算出的農曆年就變成新的一年，
   * 虛歲自動加一；國曆生日還沒到的人，實歲與虛歲會差兩歲而不是一歲。
   */
  nominalAge: number | null;
  isDeceased: boolean;
  deceasedAt: string | null;
  memberNotes: string | null;

  householdName: string;
  householdContactName: string | null;
  householdPhone: string | null;
  householdAddress: string | null;
  householdCompanyName: string | null;

  // 以下來自 DevoteeProfile（可能是 null，代表這位信眾還沒有延伸資料）
  devoteeProfileId: string | null;
  mobile: string | null;
  lineId: string | null;
  email: string | null;
  companyName: string | null;
  personalNote: string | null;
  isDisabled: boolean;
  disabledReason: string | null;
  careFlag: boolean;
  careReason: string | null;
  careNote: string | null;
  careAssignedToName: string | null;
  lastContactedAt: string | null;
  nextContactSuggestedAt: string | null;
  createdAt: string; // 沿用 Member.createdAt（信眾資料本身的建立時間，不是 DevoteeProfile 的建立時間——見下方說明）
  updatedAt: string; // Member.updatedAt 與 DevoteeProfile.updatedAt 兩者較新的一個
};

/**
 * 把 Member（+其 Household）與（可能不存在的）DevoteeProfile 組成統一的
 * 顯示格式。這是信眾名單、360 總覽「基本資料」區塊、首頁統計共用的唯一
 * 組裝函式，避免各處各自拼欄位、拼出不一致的結果。
 */
export function composeDevoteeSummary(
  member: Member & {
    household: { id: string; name: string; contactName: string | null; phone: string | null; address: string | null; companyName: string | null };
    devoteeProfile: DevoteeProfile | null;
  }
): DevoteeSummary {
  // V13.1：改用防護版——單筆資料異常時該筆顯示「未填寫」，
  // 不會讓整個頁面 500（lunarBirthMonth 是無值域限制的 Int?）。
  const birthday = safeDeriveBirthdayInfo({
    solarBirthDate: member.solarBirthDate,
    lunarBirthYear: member.lunarBirthYear,
    lunarBirthMonth: member.lunarBirthMonth,
    lunarBirthDay: member.lunarBirthDay,
    lunarIsLeapMonth: member.lunarIsLeapMonth,
  });
  const p = member.devoteeProfile;

  const memberUpdatedAt = member.updatedAt;
  const profileUpdatedAt = p?.updatedAt ?? null;
  const latestUpdatedAt =
    profileUpdatedAt && profileUpdatedAt.getTime() > memberUpdatedAt.getTime() ? profileUpdatedAt : memberUpdatedAt;

  return {
    memberId: member.id,
    householdId: member.householdId,
    name: member.name,
    gender: member.gender,
    role: member.role,
    isPrimaryContact: member.isPrimaryContact,
    solarBirthDate: birthday ? birthday.solarDate.toISOString().slice(0, 10) : null,
    lunarBirthDisplay: birthday ? formatLunarDate(birthday.lunar) : null,
    lunarBirthYear: member.lunarBirthYear ?? null,
    lunarBirthMonth: member.lunarBirthMonth ?? (birthday ? birthday.lunar.month : null),
    lunarBirthDay: member.lunarBirthDay ?? (birthday ? birthday.lunar.day : null),
    lunarIsLeapMonth: member.lunarIsLeapMonth,
    birthHour: member.birthHour ?? null,
    // V13.1：三者共用同一個 birthday 物件（deriveBirthdayInfo 的結果），
    // 不各自重算，也不新增第二套計算方式。
    zodiac: birthday?.zodiac ?? null,
    actualAge: birthday?.actualAge ?? null,
    nominalAge: birthday?.nominalAge ?? null,
    isDeceased: member.isDeceased,
    deceasedAt: member.deceasedAt ? member.deceasedAt.toISOString().slice(0, 10) : null,
    memberNotes: member.notes,

    householdName: member.household.name,
    householdContactName: member.household.contactName,
    householdPhone: member.household.phone,
    householdAddress: member.household.address,
    householdCompanyName: member.household.companyName,

    devoteeProfileId: p?.id ?? null,
    mobile: p?.mobile ?? null,
    lineId: p?.lineId ?? null,
    email: p?.email ?? null,
    companyName: p?.companyName ?? null,
    personalNote: p?.personalNote ?? null,
    isDisabled: p?.isDisabled ?? false,
    disabledReason: p?.disabledReason ?? null,
    careFlag: p?.careFlag ?? false,
    careReason: p?.careReason ?? null,
    careNote: p?.careNote ?? null,
    careAssignedToName: p?.careAssignedToName ?? null,
    lastContactedAt: p?.lastContactedAt ? p.lastContactedAt.toISOString().slice(0, 10) : null,
    nextContactSuggestedAt: p?.nextContactSuggestedAt ? p.nextContactSuggestedAt.toISOString().slice(0, 10) : null,
    createdAt: member.createdAt.toISOString(),
    updatedAt: latestUpdatedAt.toISOString(),
  };
}

/** Prisma include 片段，供各查詢共用，確保 composeDevoteeSummary() 需要的欄位都有取到。 */
export const DEVOTEE_SUMMARY_INCLUDE = {
  household: {
    select: { id: true, name: true, contactName: true, phone: true, address: true, companyName: true },
  },
  devoteeProfile: true,
} as const;

/**
 * 取得（不存在就建立）一筆 DevoteeProfile。只有真的需要寫入延伸資料時才
 * 呼叫這個函式——單純查看名單/360 總覽不需要呼叫，見上方檔案說明。
 */
export async function getOrCreateDevoteeProfile(memberId: string): Promise<DevoteeProfile> {
  const existing = await prisma.devoteeProfile.findUnique({ where: { memberId } });
  if (existing) return existing;

  const member = await prisma.member.findUnique({ where: { id: memberId } });
  if (!member || member.deletedAt) {
    throw new Error("找不到這位信眾（家戶成員），無法建立信眾延伸資料");
  }

  return prisma.devoteeProfile.create({ data: { memberId } });
}

export type UpdateDevoteeProfileInput = {
  mobile?: string | null;
  lineId?: string | null;
  email?: string | null;
  companyName?: string | null;
  personalNote?: string | null;
  isDisabled?: boolean;
  disabledReason?: string | null;
};

/**
 * 修改信眾延伸資料（對應指令「七」）。
 *
 * ⚠️ 欄位層級的權限差異（對應指令「十六」ADMIN「修改一般信眾資料」vs
 * SUPER_ADMIN「新增/修改」全部）：這裡不區分欄位，統一交給呼叫端（API
 * route）決定要不要允許某個角色呼叫這個函式——因為指令對「一般信眾資料」
 * 沒有進一步列出哪些欄位算「敏感」，這裡目前沒有任何欄位被歸類為
 * SUPER_ADMIN 專屬，ADMIN 能修改的就是這裡列出的全部延伸資料欄位。如果
 * 之後要新增「僅 SUPER_ADMIN 能改」的欄位（例如停用/啟用可能需要更高權限），
 * 應該在 API 層用 assertDevoteePermission() 針對更嚴格的 action 個別檢查，
 * 不需要修改這支函式本身。
 */
export async function updateDevoteeProfile(
  memberId: string,
  input: UpdateDevoteeProfileInput,
  operatorName: string
): Promise<DevoteeProfile> {
  const before = await getOrCreateDevoteeProfile(memberId);

  const after = await prisma.devoteeProfile.update({
    where: { memberId },
    data: input,
  });

  await recordVersion({
    entityType: "DevoteeProfile",
    entityId: after.id,
    action: "UPDATE",
    beforeData: toJsonSnapshot(before),
    afterData: toJsonSnapshot(after),
    operatorName,
    changeNote: `修改信眾延伸資料（${memberId}）`,
  });

  return after;
}
