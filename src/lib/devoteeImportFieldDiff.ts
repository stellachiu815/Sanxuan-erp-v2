/**
 * V29 第二階段（A＋B）：信眾資料匯入預檢中心「成員逐欄差異＋安全校正」的**純函式核心**。
 *
 * 只負責：把一位配對成功的信眾，逐欄比對 Excel 值 vs DB 現值，分類差異；並依「校正模式」與
 * 使用者勾選，產出**安全的更新 patch**。不 import Prisma、不寫入、不配對（配對沿用既有
 * matchIncomingMember）。所有安全規則集中在這裡，方便測試。
 *
 * 可校正欄位範圍（依 V29 確認）：
 *   Member         ：gender / solarBirthDate / lunarBirth（農曆整組）/ nationalId / address / role
 *   DevoteeProfile ：mobile / email
 *   排除：電話（phone，無寫入欄位）、生肖/年齡（由生日換算，不存）、姓名（配對錨點）、牌位地址。
 *
 * 安全規則（B）：
 *   - Excel 空白 → 永不覆蓋 DB（該欄不進 patch）。
 *   - 相同值 → 不寫入。
 *   - DB 空白、Excel 有值 → 補空白（兩種模式都允許，屬「可安全更新」）。
 *   - DB 有值且與 Excel 不同 → 只有「以 Excel 校正錯值」模式**且使用者勾選該欄**才覆蓋。
 *   - DB 有值、Excel 空白（DB 有 Excel 無）→ 只顯示，永不清空。
 */

export type CorrectableField =
  | "gender"
  | "solarBirthDate"
  | "lunarBirth"
  | "nationalId"
  | "address"
  | "role"
  | "mobile"
  | "email";

export const CORRECTABLE_FIELDS: CorrectableField[] = [
  "gender",
  "solarBirthDate",
  "lunarBirth",
  "nationalId",
  "address",
  "role",
  "mobile",
  "email",
];

export const CORRECTABLE_FIELD_LABELS: Record<CorrectableField, string> = {
  gender: "性別",
  solarBirthDate: "國曆生日",
  lunarBirth: "農曆生日",
  nationalId: "身分證字號",
  address: "通訊地址",
  role: "身份",
  mobile: "手機",
  email: "Email",
};

/** DevoteeProfile 欄位（其餘為 Member 欄位）。 */
const PROFILE_FIELDS = new Set<CorrectableField>(["mobile", "email"]);
export function isProfileField(f: CorrectableField): boolean {
  return PROFILE_FIELDS.has(f);
}

/** Excel 側一位信眾的可校正值（皆已正規化；空白為 null）。 */
export type ExcelSideValues = {
  gender: string | null;
  solarBirthDate: string | null; // yyyy-MM-dd
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  nationalId: string | null;
  address: string | null;
  role: string | null;
  mobile: string | null;
  email: string | null;
};

/** DB 側一位信眾的現值（Member ＋ DevoteeProfile）。 */
export type DbSideValues = {
  gender: string | null;
  solarBirthDate: string | null; // yyyy-MM-dd（呼叫端以 toCalendarDateKey 正規化後傳入）
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
  nationalId: string | null;
  address: string | null;
  role: string | null;
  mobile: string | null;
  email: string | null;
};

/** 逐欄差異狀態。 */
export type FieldDiffStatus =
  | "SAME" // 相同（含兩邊皆空）
  | "FILL_BLANK" // DB 空白、Excel 有值 → 可安全補空白
  | "DIFF" // 兩邊都有值且不同 → 需校正模式＋勾選才覆蓋
  | "DB_ONLY"; // DB 有值、Excel 空白 → 只顯示，永不清空

export type FieldDiff = {
  field: CorrectableField;
  label: string;
  excel: string | null; // 顯示字串
  db: string | null; // 顯示字串
  status: FieldDiffStatus;
};

function normStr(v: string | null): string | null {
  if (v == null) return null;
  const t = v.replace(/\s+/g, "").trim();
  return t.length > 0 ? t : null;
}

function lunarStr(y: number | null, m: number | null, d: number | null, leap: boolean): string | null {
  if (!y || !m || !d) return null;
  return `${y}-${m}-${d}${leap ? "(閏)" : ""}`;
}

/** 逐欄比對；回傳固定欄位順序的差異清單（含 SAME，供 UI 顯示「完全一致」）。 */
export function computeFieldDiffs(excel: ExcelSideValues, db: DbSideValues): FieldDiff[] {
  const rows: FieldDiff[] = [];
  const push = (field: CorrectableField, ex: string | null, dbv: string | null) => {
    const e = field === "address" || field === "nationalId" || field === "mobile" ? normStr(ex) : ex && ex.trim() ? ex.trim() : null;
    const d = field === "address" || field === "nationalId" || field === "mobile" ? normStr(dbv) : dbv && dbv.trim() ? dbv.trim() : null;
    let status: FieldDiffStatus;
    if ((e ?? "") === (d ?? "")) status = "SAME";
    else if (d == null) status = "FILL_BLANK"; // db 空、excel 有
    else if (e == null) status = "DB_ONLY"; // excel 空、db 有
    else status = "DIFF"; // 都有、不同
    rows.push({ field, label: CORRECTABLE_FIELD_LABELS[field], excel: ex, db: dbv, status });
  };

  push("gender", excel.gender, db.gender);
  push("solarBirthDate", excel.solarBirthDate, db.solarBirthDate);
  push(
    "lunarBirth",
    lunarStr(excel.lunarBirthYear, excel.lunarBirthMonth, excel.lunarBirthDay, excel.lunarIsLeapMonth),
    lunarStr(db.lunarBirthYear, db.lunarBirthMonth, db.lunarBirthDay, db.lunarIsLeapMonth)
  );
  push("nationalId", excel.nationalId, db.nationalId);
  push("address", excel.address, db.address);
  push("role", excel.role, db.role);
  push("mobile", excel.mobile, db.mobile);
  push("email", excel.email, db.email);
  return rows;
}

/** 一位配對成功信眾的整體分類（record-level）。 */
export type RowCategory =
  | "IDENTICAL" // 完全一致：沒有任何 FILL_BLANK / DIFF
  | "SAFE_UPDATE" // 可安全更新：配對安全，且有 FILL_BLANK 或 DIFF 可處理
  | "NEEDS_REVIEW"; // 待確認：配對不安全（同名多人/跨戶/編號不一致/衝突/多候選/信心不足）

/**
 * 依配對是否安全 + 逐欄差異，決定 record 分類。
 * matchSafe＝matchIncomingMember 的 suggestion 是否為 SKIP_SAME_PERSON（家戶編號＋姓名唯一），
 * 或 HIGH（姓名＋電話/生日）。NEEDS_REVIEW 一律 → 待確認。
 */
export function classifyRow(matchSafe: boolean, diffs: FieldDiff[]): RowCategory {
  if (!matchSafe) return "NEEDS_REVIEW";
  const hasActionable = diffs.some((d) => d.status === "FILL_BLANK" || d.status === "DIFF");
  return hasActionable ? "SAFE_UPDATE" : "IDENTICAL";
}

export type CorrectionMode = "FILL_BLANK_ONLY" | "CORRECT_WITH_EXCEL";

/**
 * 依模式＋使用者勾選欄位，判斷某一欄是否可寫入。
 *   - 未勾選 → 不寫。
 *   - Excel 空白（該欄 status 不會是 FILL_BLANK/DIFF）→ 不寫（永不覆蓋/清空）。
 *   - status SAME / DB_ONLY → 不寫。
 *   - status FILL_BLANK → 兩種模式都可寫（補空白）。
 *   - status DIFF → 只有 CORRECT_WITH_EXCEL 模式可寫。
 */
export function isFieldWritable(
  status: FieldDiffStatus,
  selected: boolean,
  mode: CorrectionMode
): boolean {
  if (!selected) return false;
  if (status === "FILL_BLANK") return true;
  if (status === "DIFF") return mode === "CORRECT_WITH_EXCEL";
  return false; // SAME / DB_ONLY
}

/**
 * 依勾選欄位集合＋模式，產出安全的欄位更新清單（僅回傳可寫欄位與其 Excel 值）。
 * 呼叫端（devoteeImportBatch commit）再把 member 欄位組成 tx.member.update、
 * profile 欄位組成 DevoteeProfile create/update。**待確認 row 不得呼叫此函式自動更新。**
 */
export function buildSelectedCorrections(
  diffs: FieldDiff[],
  selectedFields: Set<CorrectableField>,
  mode: CorrectionMode
): CorrectableField[] {
  return diffs
    .filter((d) => isFieldWritable(d.status, selectedFields.has(d.field), mode))
    .map((d) => d.field);
}
