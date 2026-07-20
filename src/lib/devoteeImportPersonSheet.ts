import { normalizeName, toNullableText, toHalfWidthDigits } from "@/lib/devoteeImportNormalize";

/**
 * V12.6「Excel 匯入中心正式版」指令四：個人資料 Excel。
 *
 * ⚠️ 這**不是第二套匯入流程**。個人 Excel 的唯一用途是「補足家戶 Excel 裡
 * 每位成員的欄位」——正式七欄的家戶檔只有姓名，指令三要求的多欄比對
 * （手機／市話／生日／地址）沒有資料來源，就是靠這一份補。
 *
 * 因此個人 Excel **不會自己產生 ImportRow**：解析後依姓名（＋家戶編號，
 * 有填的話）掛回對應的家戶列，跟著同一個 ImportBatch、同一套預檢分類、
 * 同一個 commit transaction 走完。沒有新資料表、沒有新的 importKind。
 *
 * 欄位沿用舊版彈性格式（src/lib/importRules.ts）已經在用的中文欄名，
 * 使用者手上的個人資料檔不需要改格式。所有欄位都是選填——個人 Excel
 * 本身就是「可選的補充檔」。
 */

/** 個人 Excel 支援的欄名（皆為選填，對應既有欄名慣例）。 */
export const PERSON_SHEET_COLUMNS = [
  "家戶編號",
  "姓名",
  "性別",
  "手機",
  "電話",
  "市話",
  "Email",
  "國曆生日",
  "農曆生日",
  "地址",
  "備註",
] as const;

export type PersonSheetRow = {
  rowNumber: number;
  /** 有填時用來精準對應家戶；沒填則只靠姓名對應 */
  householdCode: string | null;
  name: string;
  gender: string | null;
  mobile: string | null;
  phone: string | null;
  email: string | null;
  /** yyyy-MM-dd，解析失敗為 null 並記在 formatErrors */
  solarBirthDate: string | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  address: string | null;
  notes: string | null;
  formatErrors: string[];
};

function cell(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== "") return raw[k];
  }
  return null;
}

/**
 * 解析日期儲存格：接受 Excel 日期物件、yyyy-MM-dd、yyyy/MM/dd。
 * 看不懂就回 null 並附上錯誤訊息（不丟例外）。
 */
function parseDateCell(raw: unknown, label: string, errors: string[]): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) {
      errors.push(`「${label}」日期不合理`);
      return null;
    }
    // Excel 日期一律當成「日曆日」，用 UTC 欄位避免時區偏移造成差一天。
    const y = raw.getUTCFullYear();
    const m = String(raw.getUTCMonth() + 1).padStart(2, "0");
    const d = String(raw.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = toHalfWidthDigits(String(raw)).trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) {
    errors.push(`「${label}」格式看不懂「${s}」，請用 yyyy-MM-dd`);
    return null;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    errors.push(`「${label}」不是存在的日期「${s}」`);
    return null;
  }
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 農曆生日：yyyy-MM-dd，閏月在後面加「(閏)」或「（閏）」，沿用舊版慣例。 */
function parseLunarCell(
  raw: unknown,
  errors: string[]
): { y: number | null; m: number | null; d: number | null; leap: boolean } {
  const empty = { y: null, m: null, d: null, leap: false };
  if (raw === null || raw === undefined) return empty;
  const original = toHalfWidthDigits(String(raw)).trim();
  if (!original) return empty;
  const leap = /[（(]\s*閏\s*[)）]/.test(original);
  const s = original.replace(/[（(]\s*閏\s*[)）]/g, "").trim().replace(/\//g, "-");
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) {
    errors.push(`「農曆生日」格式看不懂「${original}」，請用 yyyy-MM-dd，閏月加「(閏)」`);
    return empty;
  }
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 30) {
    errors.push(`「農曆生日」日期不合理「${original}」`);
    return empty;
  }
  return { y, m: mo, d, leap };
}

/** 解析整份個人 Excel。看不懂的列不會中斷整份解析，錯誤逐列記錄。 */
export function parsePersonSheet(rawRows: Record<string, unknown>[]): PersonSheetRow[] {
  const out: PersonSheetRow[] = [];

  rawRows.forEach((raw, i) => {
    const formatErrors: string[] = [];
    const name = normalizeName(cell(raw, "姓名"));
    // 沒有姓名的列無法對應到任何成員，直接略過（不視為錯誤——很多檔案結尾
    // 會有空白列或合計列）。
    if (!name) return;

    const lunar = parseLunarCell(cell(raw, "農曆生日"), formatErrors);

    out.push({
      rowNumber: i + 2, // 1 是標題列
      householdCode: normalizeName(cell(raw, "家戶編號")) || null,
      name,
      gender: toNullableText(cell(raw, "性別")),
      mobile: toNullableText(cell(raw, "手機")),
      phone: toNullableText(cell(raw, "市話", "電話")),
      email: toNullableText(cell(raw, "Email", "email", "E-mail")),
      solarBirthDate: parseDateCell(cell(raw, "國曆生日"), "國曆生日", formatErrors),
      lunarBirthYear: lunar.y,
      lunarBirthMonth: lunar.m,
      lunarBirthDay: lunar.d,
      lunarIsLeapMonth: lunar.leap,
      address: toNullableText(cell(raw, "地址")),
      notes: toNullableText(cell(raw, "備註")),
      formatErrors,
    });
  });

  return out;
}

/**
 * 把個人 Excel 的列，掛到家戶 Excel 的成員上。
 *
 * 對應規則（保守，指令四「不得只用姓名」的第一道防線）：
 *   1. 個人列有填家戶編號 → 只對應到該家戶編號的那一戶，姓名需相同
 *   2. 個人列沒填家戶編號 → 只在「全檔案中該姓名只出現一次」時才對應
 *      （同名出現在多戶時無法判斷是哪一位，一律不對應，並回報 ambiguous）
 *
 * @returns key = `${householdCode}::${memberName}`
 */
export function buildPersonLookup(persons: PersonSheetRow[]): {
  byHouseholdAndName: Map<string, PersonSheetRow>;
  /** 沒填家戶編號、且姓名在檔案中唯一 → 可用姓名對應 */
  byUniqueName: Map<string, PersonSheetRow>;
  /** 沒填家戶編號、姓名重複 → 無法判斷歸屬，供預檢顯示 */
  ambiguousNames: string[];
} {
  const byHouseholdAndName = new Map<string, PersonSheetRow>();
  const nameCounts = new Map<string, number>();
  const nameFirst = new Map<string, PersonSheetRow>();

  for (const p of persons) {
    if (p.householdCode) {
      byHouseholdAndName.set(`${p.householdCode}::${p.name}`, p);
      continue;
    }
    nameCounts.set(p.name, (nameCounts.get(p.name) ?? 0) + 1);
    if (!nameFirst.has(p.name)) nameFirst.set(p.name, p);
  }

  const byUniqueName = new Map<string, PersonSheetRow>();
  const ambiguousNames: string[] = [];
  for (const [name, count] of nameCounts) {
    if (count === 1) byUniqueName.set(name, nameFirst.get(name)!);
    else ambiguousNames.push(name);
  }

  return { byHouseholdAndName, byUniqueName, ambiguousNames };
}

/** 取得某一戶某位成員對應的個人資料（找不到回 null）。 */
export function lookupPerson(
  lookup: ReturnType<typeof buildPersonLookup>,
  householdCode: string,
  memberName: string
): PersonSheetRow | null {
  return (
    lookup.byHouseholdAndName.get(`${householdCode}::${memberName}`) ??
    lookup.byUniqueName.get(memberName) ??
    null
  );
}
