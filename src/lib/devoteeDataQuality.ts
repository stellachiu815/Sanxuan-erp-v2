/**
 * V12.5「信眾資料完整化」指令二＋六：資料完整度與資料品質檢查。
 *
 * ⚠️ 這支檔案刻意**不 import 任何 Prisma／Next 模組**——純粹的判斷邏輯，
 * 前端（信眾詳情頁）與後端都能直接引用同一份規則，不會出現「畫面說完整、
 * 後端卻認為缺漏」的分歧。方法論比照既有的
 * src/lib/devoteeDuplicateMatcher.ts／src/lib/permissions.ts。
 *
 * ⚠️ 指令六明訂「僅提醒，不阻止儲存」：這裡的所有函式都只回傳「訊息」，
 * 沒有任何一個會丟錯誤或回傳「不可儲存」。呼叫端不得把它當成擋下儲存的
 * 條件。
 */

// ============================================================
// 一、資料完整度（指令二）
// ============================================================

/**
 * 完整度檢查的欄位。`anchor` 是畫面上對應欄位的 DOM id，
 * 讓「點一下跳到對應欄位」不需要在元件裡再寫一份對照表。
 */
export type CompletenessKey =
  | "mobile"
  | "address"
  | "solarBirth"
  | "lunarBirth"
  | "email"
  | "household";

export type CompletenessItem = {
  key: CompletenessKey;
  label: string;
  filled: boolean;
  anchor: string;
};

export type DevoteeCompletenessInput = {
  mobile: string | null;
  email: string | null;
  /** 目前系統只有家戶地址一份（Household.address），沒有個人地址。 */
  address: string | null;
  solarBirthDate: string | null;
  lunarBirthDisplay: string | null;
  householdId: string | null;
};

/**
 * 六個欄位對應指令二列出的六項。刻意**不**把姓名列進來——姓名是建立時
 * 就強制必填的，不可能缺，列出來只會讓清單變吵。
 */
export function evaluateDevoteeCompleteness(input: DevoteeCompletenessInput): {
  items: CompletenessItem[];
  filledCount: number;
  total: number;
  /** 0–5 顆星，用於「★★★★★ 完整」的呈現 */
  stars: number;
  isComplete: boolean;
} {
  const has = (v: string | null) => Boolean(v && v.trim());

  const items: CompletenessItem[] = [
    { key: "mobile", label: "手機", filled: has(input.mobile), anchor: "field-mobile" },
    { key: "address", label: "地址", filled: has(input.address), anchor: "field-address" },
    { key: "solarBirth", label: "國曆生日", filled: has(input.solarBirthDate), anchor: "field-birthday" },
    { key: "lunarBirth", label: "農曆生日", filled: has(input.lunarBirthDisplay), anchor: "field-birthday" },
    { key: "email", label: "Email", filled: has(input.email), anchor: "field-email" },
    { key: "household", label: "家戶", filled: has(input.householdId), anchor: "field-household" },
  ];

  const total = items.length;
  const filledCount = items.filter((i) => i.filled).length;
  // 六項換算成五顆星，四捨五入；全滿才給 5 顆。
  const stars = filledCount === total ? 5 : Math.round((filledCount / total) * 5);

  return { items, filledCount, total, stars, isComplete: filledCount === total };
}

// ============================================================
// 二、資料品質（指令六）
// ============================================================

export type QualityIssue = {
  field: "mobile" | "phone" | "email" | "solarBirthDate" | "lunarBirth" | "address";
  message: string;
};

/**
 * 台灣電話格式檢查（寬鬆）。
 *
 * 刻意寬鬆的理由：宮廟名冊裡本來就存在各種既有寫法（02-1234-5678、
 * (02)12345678、0912 345 678、含分機），全部視為錯誤會讓提示變成雜訊。
 * 這裡只抓「明顯不像電話」的情況：去掉常見分隔符後不是純數字、或長度
 * 明顯不合理。
 */
function checkPhoneLike(raw: string, label: string, field: QualityIssue["field"]): QualityIssue | null {
  const digits = raw.replace(/[\s\-()+#]|轉|分機|ext\.?/gi, "");
  if (!/^\d+$/.test(digits)) {
    return { field, message: `${label}含有非數字字元，請確認是否輸入正確` };
  }
  if (digits.length < 7 || digits.length > 15) {
    return { field, message: `${label}長度看起來不正確（目前 ${digits.length} 碼）` };
  }
  return null;
}

/** 手機額外檢查：台灣手機是 09 開頭共 10 碼。 */
function checkMobile(raw: string): QualityIssue | null {
  const base = checkPhoneLike(raw, "手機", "mobile");
  if (base) return base;
  const digits = raw.replace(/[\s\-()+#]/g, "");
  if (!/^09\d{8}$/.test(digits)) {
    return { field: "mobile", message: "手機格式通常是 09 開頭共 10 碼，請確認是否輸入正確" };
  }
  return null;
}

/** Email 格式：只做基本結構檢查，不做 DNS 或 RFC 完整驗證。 */
function checkEmail(raw: string): QualityIssue | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
    return { field: "email", message: "Email 格式看起來不正確（需包含 @ 與網域）" };
  }
  return null;
}

/** 國曆生日：格式、真實存在的日期、合理範圍。 */
function checkSolarBirthDate(raw: string): QualityIssue | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!m) {
    return { field: "solarBirthDate", message: "國曆生日格式需為 yyyy-MM-dd" };
  }
  const [, ys, ms, ds] = m;
  const y = Number(ys), mo = Number(ms), d = Number(ds);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // 回讀確認沒有進位（例如 2/30 會被 Date 自動變成 3/2）
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return { field: "solarBirthDate", message: "國曆生日不是一個存在的日期" };
  }
  const thisYear = new Date().getUTCFullYear();
  if (y < 1890 || y > thisYear) {
    return { field: "solarBirthDate", message: `國曆生日年份 ${y} 看起來不合理，請確認` };
  }
  return null;
}

/** 農曆生日：月 1–12、日 1–30、年份合理。 */
function checkLunarBirth(y: number | null, mo: number | null, d: number | null): QualityIssue | null {
  if (!y && !mo && !d) return null;
  if (!y || !mo || !d) {
    return { field: "lunarBirth", message: "農曆生日需完整填寫年、月、日" };
  }
  if (mo < 1 || mo > 12) return { field: "lunarBirth", message: "農曆月份需介於 1–12" };
  if (d < 1 || d > 30) return { field: "lunarBirth", message: "農曆日需介於 1–30" };
  const thisYear = new Date().getUTCFullYear();
  if (y < 1890 || y > thisYear) {
    return { field: "lunarBirth", message: `農曆生日年份 ${y} 看起來不合理，請確認` };
  }
  return null;
}

export type DevoteeQualityInput = {
  mobile?: string | null;
  phone?: string | null;
  email?: string | null;
  solarBirthDate?: string | null;
  lunarBirthYear?: number | null;
  lunarBirthMonth?: number | null;
  lunarBirthDay?: number | null;
  address?: string | null;
  /** 同一戶其他成員的地址，用於「重複地址提示」（指令六）。 */
  otherHouseholdAddresses?: { name: string; address: string | null }[];
};

/**
 * 回傳所有品質提醒。**空陣列代表沒有可疑之處，不代表資料完整**
 * （完整度請用 evaluateDevoteeCompleteness）。
 *
 * ⚠️ 呼叫端必須把結果當成「提醒」顯示，不得據此阻止儲存（指令六）。
 */
export function checkDevoteeDataQuality(input: DevoteeQualityInput): QualityIssue[] {
  const issues: QualityIssue[] = [];
  const t = (v: string | null | undefined) => (v && v.trim() ? v.trim() : null);

  const mobile = t(input.mobile);
  if (mobile) {
    const i = checkMobile(mobile);
    if (i) issues.push(i);
  }

  const phone = t(input.phone);
  if (phone) {
    const i = checkPhoneLike(phone, "市話", "phone");
    if (i) issues.push(i);
  }

  const email = t(input.email);
  if (email) {
    const i = checkEmail(email);
    if (i) issues.push(i);
  }

  const solar = t(input.solarBirthDate);
  if (solar) {
    const i = checkSolarBirthDate(solar);
    if (i) issues.push(i);
  }

  const lunar = checkLunarBirth(
    input.lunarBirthYear ?? null,
    input.lunarBirthMonth ?? null,
    input.lunarBirthDay ?? null
  );
  if (lunar) issues.push(lunar);

  // 重複地址提示：同一戶內出現完全相同的地址是正常的（本來就同住），
  // 這裡提示的是「地址與同戶其他人完全相同」以外的情境沒有意義，
  // 因此改成提示「這個地址已經有人使用」，由行政人員自行判斷是否合理。
  const address = t(input.address);
  if (address && input.otherHouseholdAddresses?.length) {
    const same = input.otherHouseholdAddresses.filter(
      (o) => o.address && o.address.trim() === address
    );
    if (same.length > 0) {
      issues.push({
        field: "address",
        message: `這個地址與同戶 ${same.length} 位成員相同（${same
          .slice(0, 3)
          .map((s) => s.name)
          .join("、")}）。同住屬正常情形，如非同住請確認。`,
      });
    }
  }

  return issues;
}
