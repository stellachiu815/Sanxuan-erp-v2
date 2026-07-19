import type { MemberRole } from "@prisma/client";
import { applyMapping } from "@/lib/smartImport";
import {
  normalizeName,
  normalizePhone,
  toNullableText,
  normalizeGender,
  normalizeDeceasedFlag,
  parseFlexibleSolarDate,
  parseFlexibleLunarDate,
  parseFlexibleLunarMonthDay,
  checkZodiacConsistency,
} from "@/lib/devoteeImportNormalize";

/**
 * V11.3「信眾資料匯入預檢中心」——單列資料驗證（需求「第四步」資料正規化
 * ＋「第五步」資料預覽的「資料不完整／格式錯誤」判斷依據）。
 *
 * 刻意跟「重複比對」（devoteeImportDuplicateCheck.ts）、「家戶分組」
 * （devoteeImportHouseholdGrouping.ts）分開——這裡只做「這一列本身資料
 * 乾不乾淨」的判斷，完全不查資料庫，方便單獨測試。
 */

export type NormalizedHouseholdFields = {
  code: string; // 戶號或原系統編號（必填，直接對應既有 Household.id）
  contactName: string | null;
  phone: string | null;
  mobile: string | null;
  address: string | null;
  companyName: string | null;
  notes: string | null;
};

export type NormalizedMemberFields = {
  name: string; // 必填
  gender: string | null;
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  birthHour: string | null;
  relationToHead: MemberRole;
  isDeceased: boolean;
  yangshangName: string | null;
  notes: string | null;
};

export type NormalizedDevoteeRow = {
  rowNumber: number;
  raw: Record<string, unknown>;
  household: NormalizedHouseholdFields;
  member: NormalizedMemberFields;
  /** 缺少必填欄位——對應「資料不完整」狀態 */
  missingFieldErrors: string[];
  /** 欄位內容看不懂（日期、農曆月日等格式問題）——對應「格式錯誤」狀態 */
  formatErrors: string[];
  /** 通過驗證但有可疑之處的提醒（例如生肖跟系統換算不符），不影響是否可匯入 */
  warnings: string[];
};

const RELATION_ALIASES: Record<string, MemberRole> = {
  戶長: "HOUSEHOLD_HEAD",
  配偶: "SPOUSE",
  兒子: "SON",
  子: "SON",
  長子: "SON",
  女兒: "DAUGHTER",
  女: "DAUGHTER",
  長女: "DAUGHTER",
  父親: "FATHER",
  父: "FATHER",
  母親: "MOTHER",
  母: "MOTHER",
  祖父: "GRANDFATHER",
  祖母: "GRANDMOTHER",
};

/** 「與戶主關係」看不懂的寫法一律歸類成「其他」（Member.role 既有預設值），不擋匯入。 */
function normalizeRelationToHead(raw: unknown): MemberRole {
  const s = toNullableText(raw);
  if (!s) return "OTHER";
  return RELATION_ALIASES[s] ?? "OTHER";
}

export function normalizeAndValidateDevoteeRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string | null>,
  rowNumber: number
): NormalizedDevoteeRow {
  const mapped = applyMapping(raw, mapping);
  const missingFieldErrors: string[] = [];
  const formatErrors: string[] = [];
  const warnings: string[] = [];

  // ---- 家戶欄位 ----
  const codeRaw = toNullableText(mapped.household_code) ?? "";
  // 「戶號或原系統編號」這裡刻意不列為必填——需求「第七步」明確把戶號當成
  // 判斷同戶的其中一個線索而非唯一依據，代表來源資料（例如舊系統匯出）有
  // 可能本來就沒有整理好的戶號。留空的列會交給 devoteeImportHouseholdGrouping.ts
  // 依地址／主要聯絡人／電話等線索嘗試判斷同戶；判斷不出來就標記「待確認
  // 家戶」，而不是在這裡直接當成錯誤列擋掉。
  if (codeRaw.length > 10) {
    formatErrors.push(`「戶號或原系統編號」不能超過 10 個字（目前「${codeRaw}」共 ${codeRaw.length} 字）`);
  }

  const household: NormalizedHouseholdFields = {
    code: codeRaw,
    contactName: toNullableText(mapped.household_contactName),
    phone: normalizePhone(mapped.household_phone),
    mobile: normalizePhone(mapped.household_mobile),
    address: toNullableText(mapped.household_address),
    companyName: toNullableText(mapped.household_companyName),
    notes: toNullableText(mapped.household_notes),
  };

  // ---- 信眾欄位 ----
  const name = normalizeName(mapped.member_name);
  if (!name) {
    missingFieldErrors.push("缺少必填欄位「姓名」");
  }

  const gender = normalizeGender(mapped.member_gender);

  const solar = parseFlexibleSolarDate(mapped.member_solarBirthDate, "國曆生日");
  if (solar.error) formatErrors.push(solar.error);

  const lunarCombined = parseFlexibleLunarDate(mapped.member_lunarBirthDate, "農曆生日");
  if (lunarCombined.error) formatErrors.push(lunarCombined.error);

  const lunarSplit = parseFlexibleLunarMonthDay(mapped.member_lunarBirthMonth, mapped.member_lunarBirthDay);
  if (lunarSplit.error) formatErrors.push(lunarSplit.error);

  if (solar.date && (lunarCombined.lunar || lunarSplit.month)) {
    formatErrors.push("「國曆生日」與「農曆生日」請只填一種，不要兩個都填");
  }

  let lunarBirthYear: number | null = null;
  let lunarBirthMonth: number | null = null;
  let lunarBirthDay: number | null = null;
  let lunarIsLeapMonth = false;
  if (!solar.date) {
    if (lunarCombined.lunar) {
      lunarBirthYear = lunarCombined.lunar.year;
      lunarBirthMonth = lunarCombined.lunar.month;
      lunarBirthDay = lunarCombined.lunar.day;
      lunarIsLeapMonth = lunarCombined.lunar.isLeapMonth;
    } else if (lunarSplit.month && lunarSplit.day) {
      lunarBirthMonth = lunarSplit.month;
      lunarBirthDay = lunarSplit.day;
    }
  }

  const zodiacInput = toNullableText(mapped.member_zodiac);
  const zodiacWarning = checkZodiacConsistency(
    zodiacInput,
    solar.date,
    lunarBirthYear ? { year: lunarBirthYear } : null
  );
  if (zodiacWarning) warnings.push(zodiacWarning);

  const deceased = normalizeDeceasedFlag(mapped.member_isDeceased);
  if (deceased.warning) warnings.push(deceased.warning);

  const yangshangName = toNullableText(mapped.member_yangshangName);

  const member: NormalizedMemberFields = {
    name,
    gender,
    solarBirthDate: solar.date,
    lunarBirthYear,
    lunarBirthMonth,
    lunarBirthDay,
    lunarIsLeapMonth,
    birthHour: toNullableText(mapped.member_birthHour),
    relationToHead: normalizeRelationToHead(mapped.member_relationToHead),
    isDeceased: deceased.value,
    yangshangName: deceased.value ? yangshangName : null,
    notes: toNullableText(mapped.member_notes),
  };

  return { rowNumber, raw, household, member, missingFieldErrors, formatErrors, warnings };
}
