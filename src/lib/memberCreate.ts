import { MemberRole, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateLunarBirthdayInput } from "@/lib/lunar";
import { memberRoleLabel } from "@/lib/labels";
import { recordVersion } from "@/lib/recordVersion";
import { resolveBirthdayFields } from "@/lib/birthdaySync";
import { normalizeNationalId, validateNationalId } from "@/lib/nationalId";
import { HouseholdManagementError } from "@/lib/householdManagement";
import { findPreCreateDuplicates } from "@/lib/devoteeDuplicates";

/**
 * V12.2「信眾建立與查詢中心」指令「三、統一新增 API 實作」。
 *
 * ⚠️ 這是整個系統**唯一一份**「新增家戶成員（＝新增信眾）」的 Prisma
 * create 邏輯。在此之前有兩份幾乎相同、但已開始分歧的實作：
 *
 *   1. src/app/api/households/[id]/members/route.ts（家戶模組正式實作）
 *   2. src/app/api/devotee-center/[memberId]/household-members/route.ts
 *      （V12.0 因為當時 (1) 沒有權限檢查而另外複製的一份）
 *
 * V12.1 已經幫 (1) 補上完全相同的權限檢查，(2) 存在的理由消失。本次依裁決
 * 事項 2／3：(1) 為唯一正式實作，(2) 改為薄轉接呼叫這裡的同一個 service，
 * 兩支 route 都**不再各自持有 Prisma create**，路由本身保留不刪除，既有
 * 呼叫端不受影響。
 *
 * 已知的兩份分歧（本次一併收斂成這裡的單一行為）：
 * - 生日解析：(1) 原本用手刻正則、(2) 用共用的 parseSolarDateString()。
 *   依指令「生日解析改用既有共用 parseSolarDateString()」，這裡統一採用 (2)
 *   的作法（它多做了「Date.UTC 自動進位」的回讀檢查，例如 2/30 會被正確
 *   擋下，比手刻正則嚴謹）。
 * - 回應格式：交由兩支 route 各自包裝成 V12.1 統一的 { success, data } 信封。
 */

export type CreateMemberInput = {
  name?: unknown;
  gender?: unknown;
  role?: unknown;
  isPrimaryContact?: unknown;
  isDeceased?: unknown;
  notes?: unknown;
  birthdayType?: unknown;
  solarBirthDate?: unknown;
  lunarBirthYear?: unknown;
  lunarBirthMonth?: unknown;
  lunarBirthDay?: unknown;
  lunarIsLeapMonth?: unknown;
  /**
   * V12.2 裁決事項 1：個人手機是主要聯絡欄位，寫入既有的
   * DevoteeProfile.mobile（不是 Household.phone，兩者是不同欄位、不同用途）。
   * DevoteeProfile 是 1 對 1 延伸表且刻意延遲建立，所以只有真的填了手機時
   * 才會建立這筆延伸資料，沒填就完全不碰——維持既有「延遲建立」設計，
   * 不會為了存一個 null 而替每位信眾都產生一筆空的 DevoteeProfile。
   */
  mobile?: unknown;
  /**
   * V12.4：Email，寫入既有的 DevoteeProfile.email（沿用既有欄位，不新增）。
   * 跟 mobile 一樣，只有真的填了才會建立 DevoteeProfile 延伸資料。
   */
  email?: unknown;
  /**
   * V13.1 指令一：身分證字號（選填）。空白存 null；只有實際輸入時才驗證格式。
   */
  nationalId?: unknown;
};

/** 正規化後、已驗證完成的建立資料（內部使用）。 */
type NormalizedMemberInput = {
  name: string;
  gender: string | null;
  role: MemberRole;
  isPrimaryContact: boolean;
  isDeceased: boolean;
  notes: string | null;
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  mobile: string | null;
  email: string | null;
  nationalId: string | null;
};

/**
 * 驗證＋正規化建立成員的輸入。驗證失敗一律丟 HouseholdManagementError
 * （沿用既有錯誤類別與 toHouseholdApiError()，不另外建立第二套錯誤機制），
 * 由呼叫端 route 轉成正確的 HTTP status。
 */
export function normalizeCreateMemberInput(input: CreateMemberInput): NormalizedMemberInput {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) throw new HouseholdManagementError("請輸入姓名");

  const role = typeof input.role === "string" ? input.role : "OTHER";
  if (!(role in memberRoleLabel)) throw new HouseholdManagementError("身份選項不正確");

  const gender = typeof input.gender === "string" && input.gender ? input.gender : null;
  const notes = typeof input.notes === "string" && input.notes.trim() ? input.notes.trim() : null;
  const mobile = typeof input.mobile === "string" && input.mobile.trim() ? input.mobile.trim() : null;
  const email = typeof input.email === "string" && input.email.trim() ? input.email.trim() : null;

  /**
   * V13.1 指令二：國曆與農曆生日**兩者都要永久保存**。
   *
   * 舊版是「填國曆就只存國曆、農曆四欄留 null」，資料庫裡永遠只有一半；
   * 現在統一交給 resolveBirthdayFields() 自動換算另一半，兩邊同時寫入。
   * 這也順帶讓建立信眾支援民國日期輸入（1140721／114/7/21／114-7-21），
   * 因為 resolveBirthdayFields 內部用的是 minguoDate.parseFlexibleDate。
   *
   * birthdayType 為 "none"／未填 → 五欄全部 null，**不補今天、不補預設生日**。
   */
  const birthday = resolveBirthdayFields({
    birthdayType: input.birthdayType as "solar" | "lunar" | "none" | undefined,
    solarBirthDate: input.solarBirthDate,
    lunarBirthYear: input.lunarBirthYear,
    lunarBirthMonth: input.lunarBirthMonth,
    lunarBirthDay: input.lunarBirthDay,
    lunarIsLeapMonth: input.lunarIsLeapMonth,
  });
  if (!birthday.ok) throw new HouseholdManagementError(birthday.error);
  const { solarBirthDate, lunarBirthYear, lunarBirthMonth, lunarBirthDay, lunarIsLeapMonth } =
    birthday.fields;

  // V13.1 指令一：身分證字號。空白 → null；有值才驗證格式。
  const nationalId = normalizeNationalId(input.nationalId);
  if (nationalId !== null) {
    const check = validateNationalId(nationalId);
    if (!check.ok) throw new HouseholdManagementError(check.reason);
  }

  return {
    name,
    gender,
    role: role as MemberRole,
    isPrimaryContact: Boolean(input.isPrimaryContact),
    isDeceased: Boolean(input.isDeceased),
    notes,
    solarBirthDate,
    lunarBirthYear,
    lunarBirthMonth,
    lunarBirthDay,
    lunarIsLeapMonth,
    mobile,
    email,
    nationalId,
  };
}

/**
 * 在既有交易內建立一位成員（＋選填的 DevoteeProfile.mobile ＋版本紀錄）。
 *
 * 抽成「吃 tx」的版本，是為了讓「建立新家戶＋第一位成員」可以跟家戶建立
 * 放在**同一個** transaction 裡（指令「三」：避免只建立一半）。單獨新增
 * 成員時請用下方的 createMemberForHousehold()。
 */
export async function createMemberInTransaction(
  tx: Prisma.TransactionClient,
  householdId: string,
  normalized: NormalizedMemberInput,
  operatorName: string | null,
  changeNote: string
) {
  const created = await tx.member.create({
    data: {
      householdId,
      name: normalized.name,
      gender: normalized.gender,
      role: normalized.role,
      isPrimaryContact: normalized.isPrimaryContact,
      isDeceased: normalized.isDeceased,
      notes: normalized.notes,
      solarBirthDate: normalized.solarBirthDate,
      lunarBirthYear: normalized.lunarBirthYear,
      lunarBirthMonth: normalized.lunarBirthMonth,
      lunarBirthDay: normalized.lunarBirthDay,
      lunarIsLeapMonth: normalized.lunarIsLeapMonth,
      // V13.1 指令一：身分證字號（已在 normalizeCreateMemberInput 驗證過）
      nationalId: normalized.nationalId,
    },
  });

  // 只有真的填了手機或 Email 才建立 DevoteeProfile（維持既有延遲建立設計，
  // 不會為了存 null 而替每位信眾都產生一筆空的延伸資料）。
  if (normalized.mobile || normalized.email) {
    await tx.devoteeProfile.create({
      data: { memberId: created.id, mobile: normalized.mobile, email: normalized.email },
    });
  }

  await recordVersion(
    {
      entityType: "Member",
      entityId: created.id,
      action: "CREATE",
      afterData: created,
      operatorName,
      changeNote,
    },
    tx
  );

  return created;
}

/**
 * 新增一位家戶成員（信眾）。整段包在 transaction 內，成員／DevoteeProfile／
 * 版本紀錄要嘛全部成功、要嘛全部不寫入。
 *
 * @param householdId 目標家戶（呼叫端必須先確認存在且未被軟刪除）
 * @param operatorName 伺服器端查到的真實操作人姓名（不接受前端自由文字）
 */
export async function createMemberForHousehold(
  householdId: string,
  input: CreateMemberInput,
  operatorName: string | null,
  changeNote = "新增家戶成員"
) {
  const normalized = normalizeCreateMemberInput(input);

  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { id: true },
  });
  if (!household) throw new HouseholdManagementError("找不到這個家戶", 404);

  const member = await prisma.$transaction((tx) =>
    createMemberInTransaction(tx, householdId, normalized, operatorName, changeNote)
  );

  return { member };
}

/**
 * 「要加入某個既有家戶」時的建立前疑似重複比對（V12.2 最後一個缺口）。
 *
 * ⚠️ 這裡**沒有任何比對邏輯**——它只負責把「電話／地址要用哪個值去比對」
 * 這件事整理好，再交給既有的 findPreCreateDuplicates()（其內部使用既有的
 * findDuplicateMatches() 三條規則與 buildBirthdayKey() 日期正規化）。
 * 抽出來是為了讓 POST /api/households/[id]/members 與
 * POST /api/devotee-center/create 的「加入既有家戶」路徑用**完全相同**的
 * 比對輸入，不會再出現一邊有檢查、一邊沒檢查，或兩邊比對基準不一致。
 *
 * 電話比對依據：個人手機優先，其次該家戶的電話——跟既有比對規則對「電話」
 * 的定義（devoteeDuplicates.ts 內 `devoteeProfile?.mobile || household.phone`）
 * 一致。地址一律取該家戶的地址。
 */
export async function findDuplicatesForExistingHousehold(
  householdId: string,
  normalized: Pick<
    NormalizedMemberInput,
    | "name"
    | "mobile"
    | "solarBirthDate"
    | "lunarBirthYear"
    | "lunarBirthMonth"
    | "lunarBirthDay"
    | "lunarIsLeapMonth"
  >
) {
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: { phone: true, address: true },
  });

  return findPreCreateDuplicates({
    name: normalized.name,
    phone: normalized.mobile || household?.phone || null,
    address: household?.address || null,
    solarBirthDate: normalized.solarBirthDate,
    lunarBirthYear: normalized.lunarBirthYear,
    lunarBirthMonth: normalized.lunarBirthMonth,
    lunarBirthDay: normalized.lunarBirthDay,
    lunarIsLeapMonth: normalized.lunarIsLeapMonth,
    // 已經確定要加入這一戶，帶上讓既有的「同一家戶內同名成員」規則生效。
    householdId,
  });
}
