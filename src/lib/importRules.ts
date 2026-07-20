/**
 * Excel 批次匯入 — 欄位定義與每一列的驗證/解析規則。
 *
 * 所有跟「匯入」有關的判斷都集中在這裡，API route 只負責讀檔、呼叫這裡的函式、
 * 寫入資料庫，方便之後調整規則時只改一個地方。
 *
 * ⚠️ 下面幾個欄位的「文字格式」是我依照需求欄位清單自行訂出的建議格式
 * （需求只列出欄位名稱，沒有規定儲存格內要怎麼填），已經在 README 與範本檔案
 * 裡寫清楚，正式使用前請先確認這個格式符合你們實際登記資料的習慣：
 *
 *   - 國曆生日／農曆生日：yyyy-MM-dd（也接受 yyyy/MM/dd）
 *   - 農曆生日如果是閏月，請在日期後面加「(閏)」，例如 1958-02-12(閏)
 *   - 是否已辭世：填「是」或「否」（空白視為「否」）
 *   - 歷代祖先／個人乙位正魂：這兩欄「有填文字才會建立祭祀資料」，
 *     文字內容就是祭祀資料的名稱（例如「王姓歷代祖先」「王小明 乙位正魂」）；
 *     兩欄都填的話，這一列會建立兩筆祭祀資料，陽上姓名/安奉位置兩筆共用
 */
import { getZodiacByLunarYear, solarToLunar } from "./lunar";
import { toSafeCalendarDate } from "./devoteeImportNormalize";

export const IMPORT_COLUMNS = [
  "家戶編號",
  "家戶名稱",
  "主要聯絡人",
  "電話",
  "地址",
  "公司名稱",
  "家戶成員姓名",
  "國曆生日",
  "農曆生日",
  "生肖",
  "是否已辭世",
  "歷代祖先",
  "個人乙位正魂",
  "陽上姓名",
  "安奉位置",
  "備註",
] as const;

export type ImportRawRow = Record<string, unknown>;

export type ParsedMember = {
  name: string;
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  isDeceased: boolean;
  yangshangName: string | null;
  notes: string | null;
};

export type ParsedWorship = {
  type: "ANCESTOR_LINE" | "INDIVIDUAL";
  displayName: string;
  location: string | null;
  yangshangName: string | null;
};

export type ParsedRow = {
  rowNumber: number;
  raw: ImportRawRow;
  householdId: string;
  household: {
    name: string;
    contactName: string | null;
    phone: string | null;
    address: string | null;
    companyName: string | null;
  };
  member: ParsedMember | null;
  worshipRecords: ParsedWorship[];
  errors: string[];
  warnings: string[];
};

/** 把原始列轉成純字串物件，方便存進資料庫的 Json 欄位（避免 Date 物件序列化問題）。 */
export function rawRowToPlainRecord(raw: ImportRawRow): Record<string, string> {
  const result: Record<string, string> = {};
  for (const col of IMPORT_COLUMNS) {
    result[col] = cell(raw, col);
  }
  return result;
}

function cell(raw: ImportRawRow, key: string): string {
  const v = raw[key];
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function toNullable(s: string): string | null {
  return s.length > 0 ? s : null;
}

/** 解析「是否已辭世」欄位，空白視為「否」，其餘只接受是/否類的常見寫法 */
function parseBoolean(s: string, errors: string[], fieldLabel: string): boolean {
  const v = s.trim();
  if (v === "") return false;
  if (["是", "true", "TRUE", "Y", "y", "1"].includes(v)) return true;
  if (["否", "false", "FALSE", "N", "n", "0"].includes(v)) return false;
  errors.push(`「${fieldLabel}」看不懂內容「${s}」，請填「是」或「否」`);
  return false;
}

/**
 * 國曆生日：接受 Excel 日期儲存格，或 yyyy-MM-dd / yyyy/MM/dd 文字。
 *
 * ⚠️ V12.9 Bug 修正（正式匯入當機的根因就在這裡）：
 *
 * 舊版是
 *
 *   if (rawValue instanceof Date) {
 *     return new Date(Date.UTC(rawValue.getFullYear(), rawValue.getMonth(), rawValue.getDate()));
 *   }
 *
 * **完全沒有檢查這個 Date 物件本身是否有效。** Excel 只要有一格損壞或
 * 格式怪異的日期，解析出來就是 Invalid Date；此時 getFullYear() 回傳
 * NaN，Date.UTC(NaN, NaN, NaN) 也是 NaN，最後 new Date(NaN) 產生
 * Invalid Date 並被原封不動送進 Prisma，觸發
 * 「Provided Date object is invalid」而讓**整批匯入中止**。
 *
 * 現在統一交給 toSafeCalendarDate()——任何無效輸入都回傳 null，
 * 絕不可能產生 Invalid Date。
 *
 * ⚠️ 日期問題改列為 **warning 而非 error**：依需求「日期錯誤不要中止整批，
 * 該筆生日設為 null，其他資料照常完成匯入」。生日不是必填欄位，不該讓
 * 一格打錯的生日擋掉整戶的姓名、地址與牌位資料。
 */
function parseSolarDate(raw: ImportRawRow, warnings: string[]): Date | null {
  const rawValue = raw["國曆生日"];

  if (rawValue instanceof Date) {
    const safe = toSafeCalendarDate(rawValue);
    if (!safe) {
      warnings.push("「國曆生日」這一格的日期無效，已略過生日欄位，其餘資料照常匯入");
    }
    return safe;
  }

  const s = cell(raw, "國曆生日");
  if (!s) return null;

  const safe = toSafeCalendarDate(s);
  if (!safe) {
    warnings.push(
      `「國曆生日」格式看不懂或日期不存在「${s}」，已略過生日欄位，其餘資料照常匯入（正確格式：yyyy-MM-dd，例如 1958-03-12）`
    );
    return null;
  }
  return safe;
}

/** 農曆生日：yyyy-MM-dd 或 yyyy/MM/dd，閏月請在後面加 (閏) */
function parseLunarDate(
  raw: ImportRawRow,
  warnings: string[]
): { year: number; month: number; day: number; isLeapMonth: boolean } | null {
  const s = cell(raw, "農曆生日");
  if (!s) return null;
  const isLeapMonth = s.includes("閏");
  const cleaned = s.replace(/[（(]?閏[）)]?/g, "").trim();
  const m = cleaned.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!m) {
    // V12.9：同 parseSolarDate，改為 warning，不阻擋整列。
    warnings.push(
      `「農曆生日」格式看不懂「${s}」，已略過生日欄位，其餘資料照常匯入（正確格式：yyyy-MM-dd，閏月請加「(閏)」）`
    );
    return null;
  }
  const [, y, mo, d] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // V12.9：補上 NaN 防護（理論上正則已保證是數字，但不依賴這個假設）
  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 30
  ) {
    warnings.push(`「農曆生日」日期不合理「${s}」，已略過生日欄位，其餘資料照常匯入`);
    return null;
  }
  return { year, month, day, isLeapMonth };
}

/**
 * 解析 Excel 的一列原始資料成結構化的 ParsedRow。
 * 只做「單列」層級的驗證（欄位格式、必填），家戶層級的一致性檢查
 * （同一家戶編號的地址是否一致等）與「是否跟資料庫既有家戶衝突」
 * 留給呼叫端（preview route）在整批資料都解析完之後再做。
 */
export function parseImportRow(raw: ImportRawRow, rowNumber: number): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  const householdId = cell(raw, "家戶編號");
  const householdName = cell(raw, "家戶名稱");
  const memberName = cell(raw, "家戶成員姓名");

  if (!householdId) errors.push("「家戶編號」不能空白");
  else if (householdId.length > 10) errors.push("「家戶編號」不能超過 10 個字");
  if (!householdName) errors.push("「家戶名稱」不能空白");
  if (!memberName) errors.push("「家戶成員姓名」不能空白");

  // V12.9：生日相關問題一律走 warnings，不阻擋整列匯入。
  const solarBirthDate = parseSolarDate(raw, warnings);
  const lunar = parseLunarDate(raw, warnings);
  /**
   * V12.9：兩種生日都有填時，明確以國曆為準並**實際忽略農曆**。
   * （先前的訊息說「農曆欄位略過」但程式仍然兩個都寫入，訊息與行為不一致。
   *   既有系統本來就會由國曆自動換算農曆，保留 Excel 的農曆值只會製造分歧。）
   */
  const effectiveLunar = solarBirthDate && lunar ? null : lunar;
  if (solarBirthDate && lunar) {
    warnings.push("「國曆生日」與「農曆生日」兩者都有填，已以國曆為準（農曆由系統自動換算），Excel 的農曆值不採用");
  }

  const isDeceased = parseBoolean(cell(raw, "是否已辭世"), errors, "是否已辭世");

  // 生肖欄位只是交叉核對用的提醒，不會擋匯入
  const zodiacInput = cell(raw, "生肖");
  if (zodiacInput) {
    let lunarYear: number | null = null;
    if (solarBirthDate) lunarYear = solarToLunar(solarBirthDate).year;
    else if (lunar) lunarYear = lunar.year;
    if (lunarYear) {
      const computed = getZodiacByLunarYear(lunarYear);
      if (computed !== zodiacInput) {
        warnings.push(`「生肖」欄位填「${zodiacInput}」，但系統依生日換算為「${computed}」，請確認`);
      }
    }
  }

  const worshipRecords: ParsedWorship[] = [];
  const ancestorLine = cell(raw, "歷代祖先");
  const individual = cell(raw, "個人乙位正魂");
  const yangshangName = toNullable(cell(raw, "陽上姓名"));
  const location = toNullable(cell(raw, "安奉位置"));
  if (ancestorLine) {
    worshipRecords.push({ type: "ANCESTOR_LINE", displayName: ancestorLine, location, yangshangName });
  }
  if (individual) {
    worshipRecords.push({ type: "INDIVIDUAL", displayName: individual, location, yangshangName });
  }

  const member: ParsedMember | null = memberName
    ? {
        name: memberName,
        solarBirthDate,
        lunarBirthYear: effectiveLunar?.year ?? null,
        lunarBirthMonth: effectiveLunar?.month ?? null,
        lunarBirthDay: effectiveLunar?.day ?? null,
        lunarIsLeapMonth: effectiveLunar?.isLeapMonth ?? false,
        isDeceased,
        yangshangName: isDeceased ? yangshangName : null,
        notes: toNullable(cell(raw, "備註")),
      }
    : null;

  return {
    rowNumber,
    raw,
    householdId,
    household: {
      name: householdName,
      contactName: toNullable(cell(raw, "主要聯絡人")),
      phone: toNullable(cell(raw, "電話")),
      address: toNullable(cell(raw, "地址")),
      companyName: toNullable(cell(raw, "公司名稱")),
    },
    member,
    worshipRecords,
    errors,
    warnings,
  };
}

/**
 * 檢查同一家戶編號在檔案內的多列，家戶層級欄位（名稱/聯絡人/電話/地址/公司）
 * 是否一致。不一致的話，這個家戶編號底下所有列都加上錯誤訊息。
 * 回傳「家戶編號 → 錯誤訊息」的對照表。
 */
export function checkHouseholdConsistency(
  rowsByHousehold: Map<string, ParsedRow[]>
): Map<string, string[]> {
  const result = new Map<string, string[]>();
  for (const [householdId, rows] of rowsByHousehold) {
    const fields: (keyof ParsedRow["household"])[] = [
      "name",
      "contactName",
      "phone",
      "address",
      "companyName",
    ];
    const fieldLabel: Record<string, string> = {
      name: "家戶名稱",
      contactName: "主要聯絡人",
      phone: "電話",
      address: "地址",
      companyName: "公司名稱",
    };
    const errs: string[] = [];
    for (const field of fields) {
      const values = new Set(
        rows.map((r) => r.household[field]).filter((v): v is string => !!v)
      );
      if (values.size > 1) {
        errs.push(
          `家戶編號 ${householdId} 在檔案裡「${fieldLabel[field]}」有不同的內容（${Array.from(values).join(" / ")}），請統一後再上傳`
        );
      }
    }
    // 檔案內同一家戶重複的成員姓名
    const nameCount = new Map<string, number>();
    for (const r of rows) {
      if (!r.member) continue;
      nameCount.set(r.member.name, (nameCount.get(r.member.name) ?? 0) + 1);
    }
    for (const [name, count] of nameCount) {
      if (count > 1) errs.push(`家戶編號 ${householdId} 的成員「${name}」在檔案裡重複出現 ${count} 次`);
    }
    if (errs.length > 0) result.set(householdId, errs);
  }
  return result;
}
