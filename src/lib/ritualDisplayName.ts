/**
 * V33.1 歷代祖先／乙位正魂 名稱「唯一」規則（純函式，client/server 共用）。
 *
 * 核心概念：**編輯值（core name）** 與 **完整顯示值（display name）** 分離。
 *   - 歷代祖先：編輯值＝「王姓」；顯示值＝「王姓歷代祖先」。
 *   - 乙位正魂：編輯值＝「陳永育」；顯示值＝「陳永育乙位正魂」。
 *
 * 規則：
 *   1. 類型只依正式欄位（category / RegistrationItemType / entryType）判斷，**絕不**用名稱文字猜測。
 *   2. 正規化只移除**字串末尾**相符的後綴（可重複，但只在末尾；絕不 global replace 誤改中間姓名）。
 *   3. 完整顯示只經同一 formatter；formatter 內建防重，已含後綴不再補字。
 *   4. 歷代祖先固定「{核心}歷代祖先」，用「姓」不用「府」。
 *
 * 所有新增/編輯/查詢/名單/Excel/API/列印/補印一律共用本模組，不得各頁自行 name + "歷代祖先"。
 */

import { displayDebtCreditorName } from "@/lib/debtCreditorName";

export const ANCESTOR_SUFFIX = "歷代祖先";
export const SOUL_SUFFIX = "乙位正魂";

/** 普渡牌位分類（與 UniversalSalvationEntryCategory 一致）。 */
export type RitualNameCategory = "ANCESTOR_LINE" | "INDIVIDUAL_SOUL" | "DEBT_CREDITOR" | "UNBORN_CHILD";

/** 只移除**字串末尾**、可重複出現的後綴（保護中間姓名不被誤改）；並 trim。 */
function stripTrailingSuffix(value: string | null | undefined, suffix: string): string {
  let r = (value ?? "").trim();
  // 僅比對末尾；重複後綴（歷代祖先歷代祖先）逐次自末尾移除，中間文字不動。
  while (suffix && r.endsWith(suffix)) {
    r = r.slice(0, r.length - suffix.length).trim();
  }
  return r;
}

/** 歷代祖先「核心名稱」：接受「王姓」「王姓歷代祖先」「王姓歷代祖先歷代祖先」→ 一律「王姓」。
 *  另相容舊「府」慣例：末尾「府」正規化為「姓」（例：王府歷代祖先→王姓），確保顯示用「姓」不用「府」。 */
export function normalizeAncestorCoreName(value: string | null | undefined): string {
  let core = stripTrailingSuffix(value, ANCESTOR_SUFFIX);
  if (core.length > 1 && core.endsWith("府")) core = core.slice(0, -1) + "姓";
  return core;
}

/** 乙位正魂「核心名稱」：接受「陳永育」「陳永育乙位正魂」「陳永育 乙位正魂」→ 一律「陳永育」。 */
export function normalizeIndividualSoulCoreName(value: string | null | undefined): string {
  return stripTrailingSuffix(value, SOUL_SUFFIX);
}

/** 歷代祖先完整顯示：核心＋歷代祖先（防重）。空值回空字串。 */
export function formatAncestorDisplayName(coreName: string | null | undefined): string {
  const core = normalizeAncestorCoreName(coreName);
  return core ? core + ANCESTOR_SUFFIX : "";
}

/** 乙位正魂完整顯示：核心＋乙位正魂（防重、無空格）。空值回空字串。 */
export function formatIndividualSoulDisplayName(coreName: string | null | undefined): string {
  const core = normalizeIndividualSoulCoreName(coreName);
  return core ? core + SOUL_SUFFIX : "";
}

/**
 * 依**正式類型**取核心名稱（供編輯框回填；只回填核心，不含後綴）。
 * 類型未知/其他 → 原樣 trim（例如無緣子女、冤親由各自規則處理）。
 */
export function ritualCoreName(category: RitualNameCategory | string | null | undefined, storedValue: string | null | undefined): string {
  switch (category) {
    case "ANCESTOR_LINE": return normalizeAncestorCoreName(storedValue);
    case "INDIVIDUAL_SOUL": return normalizeIndividualSoulCoreName(storedValue);
    default: return (storedValue ?? "").trim();
  }
}

/**
 * 依**正式類型**取完整顯示名稱（所有非編輯畫面/輸出唯一入口）。type 只依欄位，不猜名稱。
 *   ANCESTOR_LINE   → 王姓歷代祖先
 *   INDIVIDUAL_SOUL → 陳永育乙位正魂
 *   DEBT_CREDITOR   → 累世冤親債主（沿用 displayDebtCreditorName 正名）
 *   UNBORN_CHILD    → 原核心（通常「無緣子女」，或自訂主文由上游處理）
 */
export function resolveRitualDisplayName(category: RitualNameCategory | string | null | undefined, coreOrStored: string | null | undefined): string {
  switch (category) {
    case "ANCESTOR_LINE": return formatAncestorDisplayName(coreOrStored);
    case "INDIVIDUAL_SOUL": return formatIndividualSoulDisplayName(coreOrStored);
    case "DEBT_CREDITOR": return displayDebtCreditorName(coreOrStored);
    case "UNBORN_CHILD": return (coreOrStored ?? "").trim();
    default: return (coreOrStored ?? "").trim();
  }
}

/**
 * 儲存前正規化：依類型把使用者輸入（可能是核心或完整）轉為**核心名稱**存檔，避免重複後綴。
 * 歷代祖先/乙位正魂 → 核心；其他類型 → 原樣 trim（不動）。
 */
export function normalizeRitualNameForStore(category: RitualNameCategory | string | null | undefined, input: string | null | undefined): string {
  switch (category) {
    case "ANCESTOR_LINE": return normalizeAncestorCoreName(input);
    case "INDIVIDUAL_SOUL": return normalizeIndividualSoulCoreName(input);
    default: return (input ?? "").trim();
  }
}

/** RegistrationItemType.key → 分類（供以正式 type 欄位判斷，不猜名稱）。 */
export function categoryFromItemKey(key: string | null | undefined): RitualNameCategory | null {
  switch (key) {
    case "US_ANCESTOR": return "ANCESTOR_LINE";
    case "US_ZHENGHUN": return "INDIVIDUAL_SOUL";
    case "US_YUANQIN": return "DEBT_CREDITOR";
    case "US_WUYUAN": return "UNBORN_CHILD";
    default: return null;
  }
}

/** V33.1 唯讀盤點分類（純函式，供盤點腳本與測試）。 */
export type RitualNameAudit =
  | "A_CORE_OK"           // 核心名稱正確（王姓）
  | "B_HAS_SUFFIX"        // 已含正確後綴（王姓歷代祖先）
  | "C_DUP_SUFFIX"        // 重複後綴（王姓歷代祖先歷代祖先）
  | "D_TYPE_TEXT_MISMATCH"// 類型與文字疑不一致（府/疑似錯類）
  | "E_UNRESOLVABLE"      // 無法安全判斷（空值/type 不明）
  | "OTHER";              // 非歷代祖先/乙位正魂

export function classifyRitualName(
  category: RitualNameCategory | string | null | undefined,
  rawValue: string | null | undefined
): { classification: RitualNameAudit; core: string; expectedDisplay: string; autoFixable: boolean; suggestion: string } {
  if (category !== "ANCESTOR_LINE" && category !== "INDIVIDUAL_SOUL") {
    return { classification: "OTHER", core: (rawValue ?? "").trim(), expectedDisplay: (rawValue ?? "").trim(), autoFixable: false, suggestion: "非歷代祖先/乙位正魂，不處理" };
  }
  const trimmed = (rawValue ?? "").trim();
  const suffix = category === "ANCESTOR_LINE" ? ANCESTOR_SUFFIX : SOUL_SUFFIX;
  const core = category === "ANCESTOR_LINE" ? normalizeAncestorCoreName(trimmed) : normalizeIndividualSoulCoreName(trimmed);
  const expectedDisplay = resolveRitualDisplayName(category, trimmed);

  if (!trimmed) return { classification: "E_UNRESOLVABLE", core, expectedDisplay, autoFixable: false, suggestion: "空值，NEEDS_REVIEW（由既有必填規則處理）" };

  // 末尾後綴重複次數
  let rest = trimmed, n = 0;
  while (rest.endsWith(suffix)) { rest = rest.slice(0, -suffix.length).trim(); n++; }

  // 畸形：去尾後綴後，**核心中間仍夾帶後綴**（例：王姓歷代祖先姓歷代祖先 → 去尾一次剩「王姓歷代祖先姓」）。
  // 這類無法安全還原核心（不能盲刪中間文字），一律 NEEDS_REVIEW，不自動改，避免半修。
  if (core.includes(ANCESTOR_SUFFIX) || core.includes(SOUL_SUFFIX)) {
    return { classification: "D_TYPE_TEXT_MISMATCH", core, expectedDisplay, autoFixable: false, suggestion: "畸形值：核心仍夾帶後綴，NEEDS_REVIEW（不自動改，需人工還原正確核心）" };
  }
  // 疑似類型/文字不一致：歷代祖先含「府」；乙位正魂卻以「姓/氏」結尾（疑似錯類）。
  const looksAncestorLike = category === "INDIVIDUAL_SOUL" && (rest.endsWith("姓") || rest.endsWith("氏")) && n === 0;
  const hasFu = category === "ANCESTOR_LINE" && rest.endsWith("府");
  const hasShi = category === "ANCESTOR_LINE" && rest.endsWith("氏");
  if (looksAncestorLike) return { classification: "D_TYPE_TEXT_MISMATCH", core, expectedDisplay, autoFixable: false, suggestion: "type=乙位正魂但文字疑為姓氏，NEEDS_REVIEW（不自動改）" };
  if (hasFu) return { classification: "D_TYPE_TEXT_MISMATCH", core, expectedDisplay, autoFixable: true, suggestion: "舊「府」→ resolver 已正規化為「姓」；資料可選擇性正規化" };
  if (hasShi) return { classification: "D_TYPE_TEXT_MISMATCH", core, expectedDisplay, autoFixable: false, suggestion: "以「氏」結尾（藍氏…）；宮方統一用「姓」則需人工確認，NEEDS_REVIEW（不自動改）" };
  if (n >= 2) return { classification: "C_DUP_SUFFIX", core, expectedDisplay, autoFixable: true, suggestion: "重複後綴，可安全正規化為單一後綴（display 已防重）" };
  if (n === 1) return { classification: "B_HAS_SUFFIX", core, expectedDisplay, autoFixable: true, suggestion: "已含後綴，formatter 防重，不急覆寫" };
  return { classification: "A_CORE_OK", core, expectedDisplay, autoFixable: true, suggestion: "核心名稱，顯示層自動補後綴" };
}

/** WorshipRecord.type → 分類（家戶永久祭祀資料；INDIVIDUAL＝乙位正魂）。 */
export function categoryFromWorshipType(type: string | null | undefined): RitualNameCategory | null {
  switch (type) {
    case "ANCESTOR_LINE": return "ANCESTOR_LINE";
    case "INDIVIDUAL": case "INDIVIDUAL_SOUL": return "INDIVIDUAL_SOUL";
    case "DEBT_CREDITOR": return "DEBT_CREDITOR";
    case "UNBORN_CHILD": return "UNBORN_CHILD";
    default: return null;
  }
}
