/**
 * V15R3：資料完整度驗證（Data Completeness Validation）——全系統共用純函式（不 import Prisma）。
 *
 * 目標：正式「確認」與正式「列印」前，逐項檢查必要欄位是否齊全；缺哪些欄位直接列出
 * （例如「⚠ 缺生肖」「⚠ 缺農曆生日」「⚠ 缺牌位地址」），而不是只寫「資料不完整」。
 * 草稿允許缺資料儲存；正式確認／正式列印必須通過。未來所有活動共用同一套規則。
 *
 * 這一層只做「給定資料 → 缺哪些欄位」的純判斷；資料的實際查詢（信眾／家戶／牌位）由呼叫端
 * 組好後傳入，方便單元測試與跨活動重用。
 */

export type MissingField = { field: string; label: string };
export type CompletenessResult = { complete: boolean; missing: MissingField[] };

/**
 * V15R3（安全地址來源）：解析祖先／乙位正魂牌位地址，**只能用這一筆自己的來源**，
 * 絕不拿同一次報名其他牌位的地址（同一 ritualRecord 可能有多筆不同牌位）。
 * 優先序（呼叫端已依 entryId／唯一關聯取好各來源後傳入）：
 *   1. 本次輸入 input.tabletAddress
 *   2. 正在編輯的**同一筆** entry 自己的 tabletAddress（更新時）
 *   3. 該筆牌位專用地址（現行 schema 無此欄，恆 null）
 *   4. 本報名所屬 Household.address
 *   5. 本信眾獨立地址（現行 schema Member 無此欄，恆 null）
 *   6. 皆無 → null（呼叫端顯示「缺牌位地址」）
 */
export function resolveTabletAddress(sources: {
  inputAddress?: string | null;
  sameEntryAddress?: string | null;
  dedicatedTabletAddress?: string | null;
  householdAddress?: string | null;
  devoteeAddress?: string | null;
}): string | null {
  const ordered = [
    sources.inputAddress,
    sources.sameEntryAddress,
    sources.dedicatedTabletAddress,
    sources.householdAddress,
    sources.devoteeAddress,
  ];
  for (const a of ordered) {
    const t = (a ?? "").trim();
    if (t.length > 0) return t;
  }
  return null;
}

function has(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "number") return Number.isFinite(v);
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function build(checks: Array<[boolean, string, string]>): CompletenessResult {
  const missing = checks.filter(([ok]) => !ok).map(([, field, label]) => ({ field, label }));
  return { complete: missing.length === 0, missing };
}

/** 缺項標籤（⚠ 前綴由呼叫端顯示時加；這裡回純欄位名，方便組字與測試）。 */
export const FIELD_LABEL = {
  name: "姓名",
  lunarBirth: "農曆生日",
  solarBirth: "國曆生日",
  address: "地址",
  zodiac: "生肖",
  gender: "性別",
  lanternKind: "燈種",
  yangshang: "陽上人",
  tabletAddress: "牌位地址",
  purchaser: "認購人",
  weight: "重量",
  amount: "金額",
} as const;

/**
 * V15R3（規則六）：農曆生日「是否可取得」——直接有農曆生日，或有國曆生日且**換算成功**。
 * 只有國曆但換算失敗 → 視為缺農曆生日（不得因有國曆就算完整）。
 * 換算由呼叫端以既有 solarToLunar 執行後傳入布林，這層保持純函式可測。
 */
export function resolveLunarAvailable(input: {
  hasLunarBirth?: boolean;
  hasSolarBirth?: boolean;
  solarToLunarOk?: boolean; // 呼叫端嘗試國曆→農曆換算的結果
}): boolean {
  if (input.hasLunarBirth) return true;
  if (input.hasSolarBirth && input.solarToLunarOk) return true;
  return false;
}

// ── 年度燈 ────────────────────────────────────────────────
export type AnnualLanternSubject = {
  name?: string | null;
  /** 農曆生日「可取得」：直接有農曆，或國曆換算成功（由呼叫端以 resolveLunarAvailable 求得）。 */
  lunarBirthResolved?: boolean;
  address?: string | null;
  zodiac?: string | null;
  gender?: string | null; // 祭改需要
};
export function checkAnnualLantern(s: AnnualLanternSubject): CompletenessResult {
  return build([
    [has(s.name), "name", FIELD_LABEL.name],
    [s.lunarBirthResolved === true, "lunarBirth", FIELD_LABEL.lunarBirth],
    [has(s.address), "address", FIELD_LABEL.address],
    [has(s.zodiac), "zodiac", FIELD_LABEL.zodiac],
    [has(s.gender), "gender", FIELD_LABEL.gender],
  ]);
}

// ── 龍鳳燈 ────────────────────────────────────────────────
export type DragonPhoenixSubject = {
  name?: string | null;
  address?: string | null;
  lunarBirthResolved?: boolean;
  zodiac?: string | null;
  lanternKind?: string | null;
};
export function checkDragonPhoenixLantern(s: DragonPhoenixSubject): CompletenessResult {
  return build([
    [has(s.name), "name", FIELD_LABEL.name],
    [has(s.address), "address", FIELD_LABEL.address],
    [s.lunarBirthResolved === true, "lunarBirth", FIELD_LABEL.lunarBirth],
    [has(s.zodiac), "zodiac", FIELD_LABEL.zodiac],
    [has(s.lanternKind), "lanternKind", FIELD_LABEL.lanternKind],
  ]);
}

// ── 中元普渡（依項目） ─────────────────────────────────────
export type UniversalSalvationItemData = {
  yangshangNames?: string[] | null;
  tabletAddress?: string | null;
  purchaserName?: string | null; // 白米認購人
  weightKg?: number | null; // 白米重量
  sponsorName?: string | null; // 贊普／隨喜贊普姓名
  amount?: number | null; // 贊普金額
};

/** 依普渡項目 key 檢查該筆資料完整度。 */
export function checkUniversalSalvationItem(itemKey: string, d: UniversalSalvationItemData): CompletenessResult {
  switch (itemKey) {
    case "US_ANCESTOR": // 歷代祖先：陽上人＋牌位地址
    case "US_ZHENGHUN": // 乙位正魂：陽上人＋牌位地址
      return build([
        [has(d.yangshangNames), "yangshang", FIELD_LABEL.yangshang],
        [has(d.tabletAddress), "tabletAddress", FIELD_LABEL.tabletAddress],
      ]);
    case "US_YUANQIN": // 冤親：陽上人（地址若需要——非必填，故不擋）
      return build([[has(d.yangshangNames), "yangshang", FIELD_LABEL.yangshang]]);
    case "US_RICE": // 白米：認購人＋重量（重量須 > 0）
      return build([
        [has(d.purchaserName), "purchaser", FIELD_LABEL.purchaser],
        [Number(d.weightKg ?? 0) > 0, "weight", FIELD_LABEL.weight],
      ]);
    case "US_SPONSOR":
    case "US_SPONSOR_DONATION": // 贊普／隨喜贊普：姓名＋金額（金額須 > 0）
      return build([
        [has(d.sponsorName), "name", FIELD_LABEL.name],
        [Number(d.amount ?? 0) > 0, "amount", FIELD_LABEL.amount],
      ]);
    default:
      // 未列管的項目視為完整（不擋），由既有流程處理。
      return { complete: true, missing: [] };
  }
}

/** 把多筆結果彙總（用於一筆報名底下多個項目）。 */
export function combineCompleteness(results: CompletenessResult[]): CompletenessResult {
  const missing = results.flatMap((r) => r.missing);
  // 去重（同 field 只留一個）。
  const seen = new Set<string>();
  const dedup = missing.filter((m) => (seen.has(m.field) ? false : (seen.add(m.field), true)));
  return { complete: dedup.length === 0, missing: dedup };
}

/** 顯示用：把缺項組成「⚠ 缺生肖、⚠ 缺農曆生日」字串。 */
export function formatMissing(result: CompletenessResult): string {
  if (result.complete) return "";
  return result.missing.map((m) => `⚠ 缺${m.label}`).join("、");
}
