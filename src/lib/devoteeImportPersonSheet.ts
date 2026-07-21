import { normalizeName, toNullableText, toHalfWidthDigits, toSafeCalendarDate } from "@/lib/devoteeImportNormalize";
import { normalizeNationalId } from "@/lib/nationalId";
import { parseFlexibleDate } from "@/lib/minguoDate";
import { normalizeGenderInput } from "@/lib/genderNormalize";

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
  // V13.1 指令一：身分證字號
  "身分證字號",
  "身分證",
  // V13.1 指令八：牌位地址。當該列資料型態為歷代祖先／乙位正魂時，
  // 「地址」欄位一律視為牌位地址；若 Excel 另外有獨立的牌位地址欄，
  // 這裡也一併支援。
  "牌位地址",
] as const;

export type PersonSheetRow = {
  rowNumber: number;
  /** 有填時用來精準對應家戶；沒填則只靠姓名對應 */
  householdCode: string | null;
  name: string;
  /**
   * V13.2：性別。**已正規化**為「男」／「女」／null。
   *
   * 無法辨識的值不會寫進這裡（會留 null），而是記在 formatErrors 進入
   * 人工確認清單——絕不猜測、絕不寫入任意文字。
   *
   * ⚠️ 性別的唯一來源是個人資料工作表的「性別」欄位。
   * 不從身分證字號推導（V13.2 明令）。
   */
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
  /**
   * V13.1 指令一：身分證字號。空白為 null（指令十三：空白必須保持 NULL）。
   * 這裡**不驗證格式**——匯入是大量既有資料，格式異常應該進預檢待處理清單
   * 由人工判斷，不是在解析階段就把整列擋掉。
   */
  nationalId: string | null;
  /**
   * V13.1 指令八：牌位地址。
   *
   * ⚠️ 這與 address（信眾個人／家戶地址）是**不同的欄位**，絕不可互相覆蓋。
   * 取值優先順序：
   *   1. Excel 若有獨立的「牌位地址」欄 → 直接使用
   *   2. 否則由呼叫端依該列的資料型態決定（歷代祖先／乙位正魂時，
   *      把 address 當作牌位地址；見 devoteeImportBatch.ts）
   * 空白保持 null，不自動推測、不由家戶地址填補。
   */
  tabletAddress: string | null;
  formatErrors: string[];
};

function cell(raw: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) {
    if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== "") return raw[k];
  }
  return null;
}

/**
 * 解析日期儲存格 → yyyy-MM-dd 字串（看不懂就回 null 並附上錯誤訊息）。
 *
 * ⚠️ V12.9：日期是否有效一律交給共用的 toSafeCalendarDate() 判斷，
 * 這裡不再自己寫一套。理由是正式匯入曾經因為某一支自行判斷的日期解析
 * 漏掉「Invalid Date 物件」而把 Invalid Date 送進 Prisma、導致整批中止；
 * 全部收斂到同一支之後，就不可能有某一條路徑漏掉檢查。
 */
function parseDateCell(raw: unknown, label: string, errors: string[]): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string" && raw.trim() === "") return null;

  /**
   * V13.1 指令十三：匯入必須支援西元、民國、Excel 原生日期、Excel Serial。
   * 交給 minguoDate.parseFlexibleDate 統一辨識；它涵蓋 toSafeCalendarDate
   * 的全部保護（Invalid Date、不存在的日期一律 null），並額外支援
   * 1140721 / 114/7/21 / 114-7-21 與 Excel 序號。
   */
  const parsed = parseFlexibleDate(raw);
  if (!parsed.ok) {
    errors.push(`「${label}」${parsed.reason}，已略過這個欄位（可用西元或民國格式，例如 2025-07-21 或 114/07/21）`);
    return null;
  }
  const safe = parsed.date;
  // 統一輸出 yyyy-MM-dd（UTC 曆法欄位，與 toSafeCalendarDate 的建構方式一致）
  const y = safe.getUTCFullYear();
  const m = String(safe.getUTCMonth() + 1).padStart(2, "0");
  const d = String(safe.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * V13.2：性別儲存格 → 「男」／「女」／null。
 *
 * 無法辨識時**不猜測**，回 null 並把原因記進 errors，該列會進入預檢的
 * 人工確認清單（V13.2 第二節）。
 */
function normalizeGenderCell(raw: unknown, errors: string[]): string | null {
  const result = normalizeGenderInput(raw);
  if (result.ok) return result.value;
  errors.push(result.reason);
  return null;
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
      // V13.2：一律經過共用正規化（男性/女性/M/F… → 男/女）。
      // 無法辨識時回 null 並在 formatErrors 留下說明，交人工確認。
      gender: normalizeGenderCell(cell(raw, "性別"), formatErrors),
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
      // V13.1：身分證一律正規化（去空白、轉大寫），空白為 null
      nationalId: normalizeNationalId(cell(raw, "身分證字號", "身分證")),
      // V13.1：Excel 若有獨立的牌位地址欄就用它；沒有時留 null，
      // 由 devoteeImportBatch 依資料型態決定是否改用 address
      tabletAddress: toNullableText(cell(raw, "牌位地址")),
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
