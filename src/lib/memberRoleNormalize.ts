/**
 * 正式信眾 Excel「身份」欄 → Member.role（MemberRole enum）正規化。
 *
 * 只做保守對照：對得上就回傳 enum 值，對不上一律回傳 null（不猜測、不寫入任意值）。
 * null 代表「這次匯入沒有可靠的身份資料」，由下游更新邏輯保留既有值（不覆蓋）。
 */
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

const ROLE_MAP: Record<string, MemberRoleValue> = {
  戶長: "HOUSEHOLD_HEAD",
  家長: "HOUSEHOLD_HEAD",
  配偶: "SPOUSE",
  夫: "SPOUSE",
  妻: "SPOUSE",
  先生: "SPOUSE",
  太太: "SPOUSE",
  兒子: "SON",
  子: "SON",
  女兒: "DAUGHTER",
  女: "DAUGHTER",
  父親: "FATHER",
  父: "FATHER",
  母親: "MOTHER",
  母: "MOTHER",
  祖父: "GRANDFATHER",
  阿公: "GRANDFATHER",
  祖母: "GRANDMOTHER",
  阿嬤: "GRANDMOTHER",
  其他: "OTHER",
};

/** 對得上回傳 enum 值；空白或對不上回傳 null（不猜測）。 */
export function normalizeMemberRole(input: unknown): MemberRoleValue | null {
  if (input === null || input === undefined) return null;
  const s = String(input).trim();
  if (!s) return null;
  return ROLE_MAP[s] ?? null;
}
