import type { FinanceAccountT, FinanceEntryKindT, FinanceDirectionT } from "@/lib/financePrisma";

/**
 * V22 財務中心純計算層（無資料庫相依，可完整單元測試）。
 *
 * 帳本規則：
 *  - 餘額 = Σ(IN) − Σ(OUT)，逐帳戶累計；OPENING/INCOME/TRANSFER_IN/ADJUSTMENT(IN) 增加，
 *    EXPENSE/TRANSFER_OUT/ADJUSTMENT(OUT) 減少。
 *  - 收入合計只計 entryKind=INCOME；支出合計只計 entryKind=EXPENSE。
 *  - 資金轉移（TRANSFER_IN/OUT）與盤點調整（ADJUSTMENT）只改餘額、不計收入/支出。
 *  - 歷史備查紀錄（isHistorical=true）：不計入餘額與收入/支出合計（期初已內含）。
 *  - 已作廢（status=VOID）紀錄不參與任何計算（呼叫端過濾後傳入）。
 */

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * 收款方式 → 帳戶映射。現金進「現金」，其餘（銀行轉帳／行動支付／支票／其他）進「銀行」。
 * 純函式，供活動收款衍生收入時判斷落點帳戶。
 */
export function accountForPaymentMethod(methodType: string): FinanceAccountT {
  return methodType === "CASH" ? "CASH" : "BANK";
}

/** 供計算的最小分錄形狀。 */
export type CalcLine = {
  account: FinanceAccountT;
  direction: FinanceDirectionT;
  amount: number;
  entryKind: FinanceEntryKindT;
  isHistorical: boolean;
  /** 帳務日期（yyyy-mm-dd），供期間篩選。 */
  date: string;
};

export type Balances = { bank: number; cash: number; total: number };

const signed = (l: CalcLine): number => (l.direction === "IN" ? l.amount : -l.amount);

/** 餘額（排除歷史備查）。可選 asOf（含當日）。 */
export function computeBalances(lines: CalcLine[], asOf?: string): Balances {
  let bank = 0;
  let cash = 0;
  for (const l of lines) {
    if (l.isHistorical) continue;
    if (asOf && l.date > asOf) continue;
    if (l.account === "BANK") bank += signed(l);
    else cash += signed(l);
  }
  bank = round2(bank);
  cash = round2(cash);
  return { bank, cash, total: round2(bank + cash) };
}

function inRange(date: string, from?: string, to?: string): boolean {
  if (from && date < from) return false;
  if (to && date > to) return false;
  return true;
}

/** 收入合計（entryKind=INCOME，排除歷史備查）。 */
export function sumIncome(lines: CalcLine[], from?: string, to?: string): number {
  return round2(
    lines
      .filter((l) => !l.isHistorical && l.entryKind === "INCOME" && inRange(l.date, from, to))
      .reduce((s, l) => s + l.amount, 0)
  );
}

/** 支出合計（entryKind=EXPENSE，排除歷史備查）。 */
export function sumExpense(lines: CalcLine[], from?: string, to?: string): number {
  return round2(
    lines
      .filter((l) => !l.isHistorical && l.entryKind === "EXPENSE" && inRange(l.date, from, to))
      .reduce((s, l) => s + l.amount, 0)
  );
}

/** 淨額 = 收入 − 支出。 */
export function netAmount(lines: CalcLine[], from?: string, to?: string): number {
  return round2(sumIncome(lines, from, to) - sumExpense(lines, from, to));
}

/** 期間帳戶異動（IN/OUT 分列，供報表「銀行/現金異動」）。 */
export function accountMovement(
  lines: CalcLine[],
  account: FinanceAccountT,
  from?: string,
  to?: string
): { inflow: number; outflow: number; net: number } {
  let inflow = 0;
  let outflow = 0;
  for (const l of lines) {
    if (l.isHistorical || l.account !== account || !inRange(l.date, from, to)) continue;
    if (l.direction === "IN") inflow += l.amount;
    else outflow += l.amount;
  }
  inflow = round2(inflow);
  outflow = round2(outflow);
  return { inflow, outflow, net: round2(inflow - outflow) };
}

/** 由帳務日期導出民國年。 */
export function rocYearOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return y - 1911;
}
