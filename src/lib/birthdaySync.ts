/**
 * V13.1 指令二：國曆生日 ⇄ 農曆生日 雙向自動同步。
 *
 * ── 這支解決的問題 ──────────────────────────────────────
 * 專案原本的 normalizeCreateMemberInput()（src/lib/memberCreate.ts）用
 * `birthdayType: "solar" | "lunar" | "none"` 決定**只存其中一種**：
 * 選國曆就只寫 solarBirthDate、農曆四欄留 null；選農曆則反過來。
 *
 * 指令二明確要求「兩者必須永久保存，不得只存其中一種」，而且輸入任一種
 * 之後系統要自動換算另一種，阿姨不需要輸入兩次。
 *
 * 所以這支提供唯一一個入口 resolveBirthdayFields()：不論使用者填的是
 * 國曆還是農曆，都回傳**完整的五個欄位**（國曆 Date + 農曆年月日 + 閏月），
 * 由呼叫端整組寫入資料庫。
 *
 * ── 三個必須守住的規則 ───────────────────────────────────
 * 1. 完全空白 → 五個欄位全部 null。**絕不補今天、絕不補預設生日**
 *    （指令二.6、二.7、十三）。
 * 2. 閏月必須正確保存（指令二.5）——lunarToSolar 有 isLeapMonth 參數，
 *    換算回來時 solarToLunar 也會回報 isLeap，來回一致。
 * 3. 換算失敗**不得靜默吞掉**，要回報錯誤讓使用者知道，而不是存一個
 *    半套資料（例如國曆有值、農曆莫名其妙是 null）。
 *
 * ── 為什麼要有 preview ──────────────────────────────────
 * 指令二.4：「換算前顯示結果，避免錯誤覆蓋」。buildBirthdayPreview()
 * 讓畫面在使用者按下儲存**之前**就能顯示「你輸入國曆 84/03/12，
 * 系統將同時記錄農曆 83 年 2 月 11 日」，確認後才送出。
 */

import { lunarToSolar, solarToLunar, validateLunarBirthdayInput } from "@/lib/lunar";
import { parseFlexibleDate, formatMinguoDate, adToMinguo } from "@/lib/minguoDate";

/** 資料庫中生日的完整五欄。 */
export type BirthdayFieldSet = {
  solarBirthDate: Date | null;
  lunarBirthYear: number | null;
  lunarBirthMonth: number | null;
  lunarBirthDay: number | null;
  lunarIsLeapMonth: boolean;
};

/** 全空的生日欄位（生日未填時使用——五欄一致為 null）。 */
export const EMPTY_BIRTHDAY: BirthdayFieldSet = {
  solarBirthDate: null,
  lunarBirthYear: null,
  lunarBirthMonth: null,
  lunarBirthDay: null,
  lunarIsLeapMonth: false,
};

export type BirthdayInput = {
  /**
   * 使用者這次填的是哪一種。
   * "none" 或未提供 → 生日整組留空。
   */
  birthdayType?: "solar" | "lunar" | "none" | null;
  /**
   * 國曆生日。接受民國與西元多種格式（見 minguoDate.parseFlexibleDate）：
   * 1140721 / 114/7/21 / 114-7-21 / 2025-07-21 / Excel Date / Excel Serial
   */
  solarBirthDate?: unknown;
  lunarBirthYear?: unknown;
  lunarBirthMonth?: unknown;
  lunarBirthDay?: unknown;
  lunarIsLeapMonth?: unknown;
};

export type BirthdayResolution =
  | { ok: true; fields: BirthdayFieldSet }
  | { ok: false; error: string };

/**
 * 依使用者輸入，算出**完整**的國曆＋農曆五個欄位。
 *
 * 這是 V13.1 之後唯一允許用來產生生日欄位的函式——建立信眾、編輯信眾、
 * Excel 匯入全部走這裡，避免三個地方各寫一套換算而彼此不一致。
 */
export function resolveBirthdayFields(input: BirthdayInput): BirthdayResolution {
  const type = input.birthdayType ?? "none";

  if (type === "none" || type === null) {
    return { ok: true, fields: { ...EMPTY_BIRTHDAY } };
  }

  if (type === "solar") {
    // 空白視為「沒填生日」，不是錯誤（指令十三：空白保持 NULL）
    if (
      input.solarBirthDate === null ||
      input.solarBirthDate === undefined ||
      (typeof input.solarBirthDate === "string" && input.solarBirthDate.trim() === "")
    ) {
      return { ok: true, fields: { ...EMPTY_BIRTHDAY } };
    }

    const parsed = parseFlexibleDate(input.solarBirthDate);
    if (!parsed.ok) {
      return { ok: false, error: `國曆生日${parsed.reason}` };
    }

    // 自動換算農曆（指令二.1）
    try {
      const lunar = solarToLunar(parsed.date);
      return {
        ok: true,
        fields: {
          solarBirthDate: parsed.date,
          lunarBirthYear: lunar.year,
          lunarBirthMonth: lunar.month,
          lunarBirthDay: lunar.day,
          lunarIsLeapMonth: Boolean(lunar.isLeapMonth),
        },
      };
    } catch {
      // 換算失敗時仍保留使用者實際輸入的國曆（那是他親手填的、確定要的），
      // 農曆留空並回報——不假裝成功、也不丟掉使用者的輸入。
      return {
        ok: false,
        error: "國曆生日已可辨識，但自動換算農曆失敗，請確認日期是否在可換算範圍內",
      };
    }
  }

  // type === "lunar"
  const y = Number(input.lunarBirthYear);
  const m = Number(input.lunarBirthMonth);
  const d = Number(input.lunarBirthDay);
  const leap = Boolean(input.lunarIsLeapMonth);

  const allBlank =
    (input.lunarBirthYear === null || input.lunarBirthYear === undefined || input.lunarBirthYear === "") &&
    (input.lunarBirthMonth === null || input.lunarBirthMonth === undefined || input.lunarBirthMonth === "") &&
    (input.lunarBirthDay === null || input.lunarBirthDay === undefined || input.lunarBirthDay === "");
  if (allBlank) {
    return { ok: true, fields: { ...EMPTY_BIRTHDAY } };
  }

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
    return { ok: false, error: "農曆生日請完整輸入年、月、日" };
  }
  const validationError = validateLunarBirthdayInput(y, m, d, leap);
  if (validationError) {
    return { ok: false, error: validationError };
  }

  // 自動換算國曆（指令二.2）
  try {
    const solar = lunarToSolar(y, m, d, leap);
    // ⚠️ lunarToSolar 依約定**已經**回傳 UTC 午夜的純日期（見 lunar.ts 註解），
    // 所以這裡必須用 getUTC* 讀取。若誤用 getFullYear()/getMonth()/getDate()
    // （本地時區），在 Asia/Taipei 會整整差一天——V12.2 的重複偵測就是踩到
    // 同一個坑。這裡刻意重新以 Date.UTC 建構一次，確保時分秒歸零。
    const normalized = new Date(
      Date.UTC(solar.getUTCFullYear(), solar.getUTCMonth(), solar.getUTCDate())
    );
    if (Number.isNaN(normalized.getTime())) {
      return { ok: false, error: "農曆生日換算國曆失敗，請確認日期是否正確" };
    }
    return {
      ok: true,
      fields: {
        solarBirthDate: normalized,
        lunarBirthYear: y,
        lunarBirthMonth: m,
        lunarBirthDay: d,
        lunarIsLeapMonth: leap,
      },
    };
  } catch {
    return { ok: false, error: "農曆生日換算國曆失敗，請確認年份是否在可換算範圍內" };
  }
}

/**
 * 補齊既有資料缺少的另一半（資料修復用）。
 *
 * 既有正式資料裡，V13.1 之前建立的信眾只會有國曆**或**農曆其中一種。
 * 這支讓「讀出來顯示」時能補上另一種，**不修改資料庫**——
 * 真正的回填由使用者編輯儲存時自然完成，系統不擅自批次改寫既有資料。
 */
export function completeBirthdayFields(existing: BirthdayFieldSet): BirthdayFieldSet {
  const hasSolar = existing.solarBirthDate instanceof Date && !Number.isNaN(existing.solarBirthDate.getTime());
  const hasLunar =
    existing.lunarBirthYear !== null &&
    existing.lunarBirthMonth !== null &&
    existing.lunarBirthDay !== null;

  if (hasSolar && hasLunar) return existing;
  if (!hasSolar && !hasLunar) return { ...EMPTY_BIRTHDAY };

  if (hasSolar) {
    try {
      const lunar = solarToLunar(existing.solarBirthDate as Date);
      return {
        ...existing,
        lunarBirthYear: lunar.year,
        lunarBirthMonth: lunar.month,
        lunarBirthDay: lunar.day,
        lunarIsLeapMonth: Boolean(lunar.isLeapMonth),
      };
    } catch {
      return existing;
    }
  }

  try {
    const solar = lunarToSolar(
      existing.lunarBirthYear as number,
      existing.lunarBirthMonth as number,
      existing.lunarBirthDay as number,
      existing.lunarIsLeapMonth
    );
    return {
      ...existing,
      // 同上：lunarToSolar 回傳 UTC 純日期，必須用 getUTC* 讀取
      solarBirthDate: new Date(
        Date.UTC(solar.getUTCFullYear(), solar.getUTCMonth(), solar.getUTCDate())
      ),
    };
  } catch {
    return existing;
  }
}

export type BirthdayPreview = {
  ok: boolean;
  /** 例：「114/07/21」 */
  solarText: string;
  /** 例：「農曆 114 年 6 月 27 日」 */
  lunarText: string;
  /** 使用者這次實際輸入的是哪一種（另一種是系統換算出來的） */
  enteredType: "solar" | "lunar" | "none";
  /** 給畫面顯示的一句話說明 */
  message: string;
};

/**
 * 儲存前的換算預覽（指令二.4：「換算前顯示結果，避免錯誤覆蓋」）。
 *
 * 純顯示用，不寫任何資料。
 */
export function buildBirthdayPreview(input: BirthdayInput): BirthdayPreview {
  const type = (input.birthdayType ?? "none") as "solar" | "lunar" | "none";
  const resolved = resolveBirthdayFields(input);

  if (!resolved.ok) {
    return {
      ok: false,
      solarText: "",
      lunarText: "",
      enteredType: type,
      message: resolved.error,
    };
  }

  const f = resolved.fields;
  if (!f.solarBirthDate && f.lunarBirthYear === null) {
    return {
      ok: true,
      solarText: "",
      lunarText: "",
      enteredType: "none",
      message: "未填寫生日（國曆與農曆皆保持空白）",
    };
  }

  const solarText = formatMinguoDate(f.solarBirthDate);
  const leapText = f.lunarIsLeapMonth ? "閏" : "";
  const lunarMinguo = f.lunarBirthYear !== null ? adToMinguo(f.lunarBirthYear) : null;
  const lunarText =
    lunarMinguo === null
      ? ""
      : `農曆 ${lunarMinguo} 年 ${leapText}${f.lunarBirthMonth} 月 ${f.lunarBirthDay} 日`;

  const message =
    type === "solar"
      ? `您輸入國曆 ${solarText}，系統將同時記錄 ${lunarText}`
      : `您輸入 ${lunarText}，系統將同時記錄國曆 ${solarText}`;

  return { ok: true, solarText, lunarText, enteredType: type, message };
}
