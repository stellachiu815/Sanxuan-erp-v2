import { round2 } from "@/lib/offeringRules";

/**
 * V11.1「全宮共用收據中心」核心業務規則（純函式、不 import Prisma / 不連線
 * 資料庫）。比照 V11.0 collectionCenterRules.ts、V9.0 purificationNumbering.ts
 * 的既有慣例獨立成這一個檔案，方便在沙盒環境用 `tsx --test` 直接驗證，
 * 不用等到能夠 `npm install` 之後才能測試最容易出錯的號碼編列與金額大寫
 * 轉換邏輯（見 tests/receiptRules.test.ts）。
 */

export { round2 };

// ============================================================
// 一、收據號碼格式（需求「七、收據號碼管理」）
// ============================================================

export type ReceiptNumberYearModeValue = "ROC" | "WESTERN";
export type ReceiptNumberResetPolicyValue = "YEARLY" | "CONTINUOUS";

export type ReceiptNumberingConfigValue = {
  prefix: string;
  yearMode: ReceiptNumberYearModeValue;
  digits: number;
  resetPolicy: ReceiptNumberResetPolicyValue;
  startNumber: number;
};

/** 依年制（民國／西元）把一個實際日期換算成收據號碼裡要顯示的年度數字。 */
export function resolveReceiptDisplayYear(yearMode: ReceiptNumberYearModeValue, date: Date): number {
  const westernYear = date.getFullYear();
  return yearMode === "ROC" ? westernYear - 1911 : westernYear;
}

/**
 * 依重編政策，決定 ReceiptSequenceCounter 要用哪一個 key 累計序號：
 * - YEARLY：每個年度各自累計，key＝該年度數字的字串。
 * - CONTINUOUS：不分年度、永遠往上累計，固定用常數 "ALL"（跟 YEARLY 的
 *   key 不會撞在一起，因為西元/民國年不會出現字串 "ALL"）。
 *
 * ⚠️ 重編政策只影響「流水號要不要每年歸零」，不影響收據號碼上顯示的年度
 * 數字本身——即使是 CONTINUOUS（不分年度連續編號），收據號碼上還是會顯示
 * 開立當下的實際年度，只是流水號的部分不會因為換年度而重新從
 * startNumber 起算。
 */
export function resolveReceiptCounterKey(resetPolicy: ReceiptNumberResetPolicyValue, displayYear: number): string {
  return resetPolicy === "YEARLY" ? String(displayYear) : "ALL";
}

/** 收據號碼格式：{前綴}-{年度}-{N位數流水號}，例如 R-2026-000001。 */
export function formatReceiptNumber(config: ReceiptNumberingConfigValue, displayYear: number, sequence: number): string {
  if (!config.prefix?.trim()) throw new Error("formatReceiptNumber: 前綴不可為空白");
  if (!Number.isInteger(config.digits) || config.digits < 1 || config.digits > 10) {
    throw new Error("formatReceiptNumber: 流水號位數必須是 1～10 之間的整數");
  }
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new Error("formatReceiptNumber: 流水號必須是非負整數");
  }
  return `${config.prefix}-${displayYear}-${String(sequence).padStart(config.digits, "0")}`;
}

/** 收據設定畫面「預覽格式」用——給定設定與範例日期/序號，算出預覽字串。 */
export function previewReceiptNumberFormat(
  config: ReceiptNumberingConfigValue,
  sampleDate: Date,
  sampleSequence?: number
): string {
  const displayYear = resolveReceiptDisplayYear(config.yearMode, sampleDate);
  return formatReceiptNumber(config, displayYear, sampleSequence ?? config.startNumber);
}

/** 收據號碼設定表單驗證（對應需求「七」：只有最高管理權限可修改，這裡只驗證數值本身是否合理）。 */
export function validateNumberingConfigInput(input: {
  prefix: string;
  digits: number;
  startNumber: number;
}): { ok: boolean; error: string | null } {
  if (!input.prefix?.trim()) return { ok: false, error: "請輸入收據號碼前綴" };
  if (!/^[A-Za-z0-9一-鿿-]{1,10}$/.test(input.prefix.trim())) {
    return { ok: false, error: "前綴只能包含英數字、中文或連字號，且長度不超過 10 個字元" };
  }
  if (!Number.isInteger(input.digits) || input.digits < 1 || input.digits > 10) {
    return { ok: false, error: "流水號位數必須是 1～10 之間的整數" };
  }
  if (!Number.isInteger(input.startNumber) || input.startNumber < 1) {
    return { ok: false, error: "起始號碼必須是大於等於 1 的整數" };
  }
  return { ok: true, error: null };
}

// ============================================================
// 二、收據可開立金額（需求「五、收據開立方式」「十三、部分收款與收據」）
// ============================================================

/**
 * 計算一筆 PaymentAllocation 目前「尚可開立收據金額」：
 * 原始分配金額 - 已透過退款/轉款/作廢沖銷掉的金額 - 已經開立（含標記不需
 * 開立，兩者都算「已處理」）且未作廢的收據明細金額加總。
 *
 * 三個輸入都是呼叫端已經從資料庫查詢/加總好的數字，這支函式本身只負責
 * 純粹的算式與下限保護（不會出現負數）。
 */
export function computeReceiptableRemaining(
  allocationAmount: number,
  adjustmentReduction: number,
  alreadyReceiptedAmount: number
): number {
  return Math.max(0, round2(allocationAmount - adjustmentReduction - alreadyReceiptedAmount));
}

export type ReceiptLineCandidateInput = {
  allocationId: string;
  amount: number;
  remaining: number;
};

/**
 * 開立收據前驗證每一筆明細金額：必須大於 0，且不得超過該筆分配目前
 * 「尚可開立收據金額」——這是防止「同一筆付款分配金額被重複開立超過實際
 * 收款金額」的核心規則（需求「五」明確要求）。
 */
export function validateReceiptLineAmounts(
  lines: ReceiptLineCandidateInput[]
): { ok: boolean; error: string | null } {
  if (!lines.length) return { ok: false, error: "請至少選擇一筆收款分配項目" };
  for (const line of lines) {
    if (!Number.isFinite(line.amount) || line.amount <= 0) {
      return { ok: false, error: "收據金額必須是大於 0 的數字" };
    }
    if (round2(line.amount) > round2(line.remaining)) {
      return {
        ok: false,
        error: `這筆分配項目開立金額（${round2(line.amount)}）超過尚可開立收據金額（${round2(line.remaining)}），可能資料已被其他人異動，請重新整理後再試`,
      };
    }
  }
  return { ok: true, error: null };
}

// ============================================================
// 三、列印次數與種類（需求「九、收據列印」「十、補印功能」）
// ============================================================

/** 第一次列印永遠是 ORIGINAL_PRINT，之後每一次都是 REPRINT（需求「九」明確規定）。 */
export function determinePrintKind(existingPrintCount: number): "ORIGINAL_PRINT" | "REPRINT" {
  return existingPrintCount > 0 ? "REPRINT" : "ORIGINAL_PRINT";
}

// ============================================================
// 四、金額國字大寫（需求「八、收據版型」「十四、收據金額國字大寫處理」）
// ============================================================

const CAPITAL_DIGITS = ["零", "壹", "貳", "參", "肆", "伍", "陸", "柒", "捌", "玖"];
const CHUNK_UNITS = ["仟", "佰", "拾", ""]; // 依序對應 4 位數字裡的千/百/十/個位

/**
 * 把 0～9999 的整數轉成中文財務大寫（不含萬/億等大單位，也不處理 0 本身，
 * 呼叫端負責在外層處理 0 與大單位）。內部規則：跳過的 0 只在「後面還有
 * 非零數字」時才補一個「零」字橋接，避免「壹仟零」這種多餘的零，也避免
 *「壹仟伍佰」漏掉中間應該有的零（例如 1005 需要是「壹仟零伍」）。
 */
function chunkToCapital(n: number): string {
  const digits = String(n).padStart(4, "0").split("").map(Number);
  let result = "";
  let zeroPending = false;
  for (let i = 0; i < 4; i++) {
    const d = digits[i];
    if (d === 0) {
      if (result.length > 0) zeroPending = true;
      continue;
    }
    if (zeroPending) {
      result += "零";
      zeroPending = false;
    }
    result += CAPITAL_DIGITS[d] + CHUNK_UNITS[i];
  }
  return result;
}

/**
 * 把 0～99,999,999（不含億以上）的非負整數轉成中文財務大寫，含「萬」大單位。
 * ⚠️ 刻意不支援億（100,000,000）以上金額——這個上限對宮廟收據的實際使用
 * 情境已經非常足夠（單張收據極不可能達到一億元），支援到億以上需要處理
 * 更複雜的多層大單位零橋接規則，容易在極端情況下出錯，因此刻意先設下限，
 * 超過時明確丟出例外，而不是硬做一個沒有充分測試過的大單位轉換。
 */
export function integerToCapital(n: number): string {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`integerToCapital: 只接受非負整數，收到 ${n}`);
  }
  if (n >= 100_000_000) {
    throw new Error("integerToCapital: 本功能僅支援一億元以下金額的國字大寫轉換");
  }
  if (n === 0) return "零";

  const wanGroup = Math.floor(n / 10000);
  const unitsGroup = n % 10000;

  if (wanGroup === 0) {
    return chunkToCapital(unitsGroup);
  }

  const wanPart = chunkToCapital(wanGroup) + "萬";
  if (unitsGroup === 0) return wanPart;

  // unitsGroup 沒有填滿到千位（< 1000）時，代表「萬」跟這個群組的第一個
  // 有效數字之間有斷層，需要補一個零橋接（例如 10001 要唸「壹萬零壹」）；
  // unitsGroup >= 1000 代表千位本身就有數字，直接銜接不需要橋接零。
  const bridge = unitsGroup < 1000 ? "零" : "";
  return wanPart + bridge + chunkToCapital(unitsGroup);
}

/**
 * 把金額轉成正式收據上使用的中文大寫金額字串，例如：
 * 7000 → "新台幣柒仟元整"
 * 1234.56 → "新台幣壹仟貳佰參拾肆元伍角陸分"
 * 100.5 → "新台幣壹佰元伍角整"
 * 100.05 → "新台幣壹佰元零伍分"
 * 0 → "新台幣零元整"
 *
 * 金額四捨五入到分（小數第二位），避免浮點數誤差；上限同 integerToCapital
 * （一億元以下）。
 */
export function amountToChineseCapital(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`amountToChineseCapital: 只接受非負數字，收到 ${amount}`);
  }
  const totalCents = Math.round(amount * 100);
  const yuan = Math.floor(totalCents / 100);
  const jiao = Math.floor((totalCents % 100) / 10);
  const fen = totalCents % 10;

  const yuanPart = yuan === 0 ? "零元" : `${integerToCapital(yuan)}元`;
  let result = `新台幣${yuanPart}`;

  if (jiao === 0 && fen === 0) {
    result += "整";
    return result;
  }

  if (jiao > 0) {
    result += `${CAPITAL_DIGITS[jiao]}角`;
  } else {
    result += "零";
  }

  if (fen > 0) {
    result += `${CAPITAL_DIGITS[fen]}分`;
  } else {
    result += "整";
  }

  return result;
}
