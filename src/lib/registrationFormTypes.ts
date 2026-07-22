import type { ActivityType } from "@prisma/client";

/**
 * V13.4 指令四／五：報名表單型態的**後端受控分派**。
 *
 * ── 為什麼需要這一支 ────────────────────────────────────────
 * 「活動清單不可寫死」與「編輯器不可任意自動生成」是兩件事：
 *
 *   活動清單     → 一律從 TempleEvent 動態取得（年份、名稱、是否開放）
 *   活動表單能力 → 依已支援的表單型態分派，**由後端受控**
 *
 * 不同活動需要完全不同的資料結構（普渡有四類牌位、祭改有編號與貼紙、
 * 年度燈有金額與快照）。期待「新增一個 activityType 就自動長出完整表單」
 * 是不可能的。
 *
 * ⚠️ 未支援或未設定的活動**絕不降級成通用參加型**：
 * 那會讓需要專屬資料的活動被建立成「看起來完成、實際缺資料」的報名，
 * 之後列印或收款才發現問題。寧可明白擋住。
 */

/** 已支援的報名表單型態。 */
export type RegistrationFormType =
  | "UNIVERSAL_SALVATION" // 普渡：四類牌位＋贊普＋寶袋
  | "PURIFICATION" // 祭改：每位成員一筆報名
  | "LANTERN" // 年度燈：光明燈／太歲燈／全家燈
  | "GENERIC"; // 通用參加：只記錄參加成員（宮慶、神明聖誕）

export const REGISTRATION_FORM_TYPES: readonly RegistrationFormType[] = [
  "UNIVERSAL_SALVATION",
  "PURIFICATION",
  "LANTERN",
  "GENERIC",
] as const;

export function isRegistrationFormType(value: unknown): value is RegistrationFormType {
  return typeof value === "string" && (REGISTRATION_FORM_TYPES as readonly string[]).includes(value);
}

/**
 * 活動類型 → 建議的表單型態。
 *
 * ⚠️ 這只是**建立活動時的預設值建議**，不是執行期的判斷依據。
 * 執行期一律讀 `TempleEvent.registrationFormType`——因為同一個活動類型
 * 未來可能需要不同的表單（例如某年度的宮慶決定要收供品）。
 *
 * 沒列在這裡的活動類型，建立活動時 registrationFormType 會是 null，
 * 需要管理者明確設定後才能報名。
 */
const SUGGESTED_FORM_TYPE: Partial<Record<ActivityType, RegistrationFormType>> = {
  UNIVERSAL_SALVATION: "UNIVERSAL_SALVATION",
  PURIFICATION: "PURIFICATION",
  GUANGMING_LANTERN: "LANTERN",
  TAISUI_LANTERN: "LANTERN",
  FAMILY_LANTERN: "LANTERN",
  TEMPLE_CELEBRATION: "GENERIC",
  GUANDI_BIRTHDAY: "GENERIC",
  XUANTIAN_BIRTHDAY: "GENERIC",
  YAOCHI_BIRTHDAY: "GENERIC",
  ZHONGTAN_BIRTHDAY: "GENERIC",
};

/** 建立活動時的預設表單型態建議。未涵蓋的類型回 null（需人工設定）。 */
export function suggestRegistrationFormType(
  activityType: ActivityType
): RegistrationFormType | null {
  return SUGGESTED_FORM_TYPE[activityType] ?? null;
}

export type FormTypeResolution =
  | { supported: true; formType: RegistrationFormType }
  | { supported: false; reason: string };

/**
 * 解析一個活動實際可用的報名表單型態。
 *
 * 這是**唯一**的分派來源——`/registration/[id]` 與「確認報名」都用它。
 *
 * @param registrationFormType TempleEvent.registrationFormType（可能是 null）
 */
export function resolveRegistrationFormType(
  registrationFormType: string | null | undefined
): FormTypeResolution {
  if (registrationFormType === null || registrationFormType === undefined || registrationFormType === "") {
    return {
      supported: false,
      reason: "此活動尚未完成報名表設定，請先於活動設定選擇報名表型態後再進行報名。",
    };
  }
  if (!isRegistrationFormType(registrationFormType)) {
    return {
      supported: false,
      reason: `此活動的報名表型態「${registrationFormType}」目前尚未支援，無法完成報名。`,
    };
  }
  return { supported: true, formType: registrationFormType };
}

/** 這個表單型態是否需要專屬子表內容才算完整。 */
export function requiresActivitySpecificContent(formType: RegistrationFormType): boolean {
  return formType !== "GENERIC";
}

/** 年度燈的三種活動類型。 */
export const LANTERN_ACTIVITY_TYPES: readonly ActivityType[] = [
  "GUANGMING_LANTERN",
  "TAISUI_LANTERN",
  "FAMILY_LANTERN",
] as const;

export function isLanternActivityType(activityType: ActivityType): boolean {
  return LANTERN_ACTIVITY_TYPES.includes(activityType);
}

/** 全家燈是家戶型：整戶一筆應收，不是一人一筆。 */
export function isHouseholdLevelLantern(activityType: ActivityType): boolean {
  return activityType === "FAMILY_LANTERN";
}
