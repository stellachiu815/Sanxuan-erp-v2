import { prisma } from "@/lib/prisma";
import { getCollectionHomeSummary } from "@/lib/collectionCenter";
import {
  financeRecords,
  financeRecordsTx,
  financeReconciliations,
  financeReconciliationsTx,
  accountForPaymentMethod,
  type FinanceAccountT,
  type FinanceEntryKindT,
  type FinanceDirectionT,
  type FinanceRecordRow,
} from "@/lib/financePrisma";
import {
  round2,
  computeBalances,
  sumIncome,
  sumExpense,
  accountMovement,
  rocYearOf,
  type CalcLine,
  type Balances,
} from "@/lib/financeCalc";

/**
 * V22 財務中心服務層（單一帳本）。
 *
 * 帳本 = FinanceRecord（期初／一般收入／支出／資金轉移／盤點調整）
 *      ∪ PaymentTransaction(COMPLETED)（活動收款，衍生為收入，付款完成立即入帳）。
 * 不重複寫入活動收款、不改動既有收款流程、不建立第二套帳務。
 * 匯出（PDF/Excel）與報表共用 getFinanceReport() 同一查詢來源。
 */

// ---------- 日期工具 ----------
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function localTodayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
export function rocYearNow(now: Date = new Date()): number {
  return now.getFullYear() - 1911;
}
function parseISODate(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}
function dayBefore(iso: string): string {
  const d = parseISODate(iso);
  d.setUTCDate(d.getUTCDate() - 1);
  return toISODate(d);
}

// ---------- 統一流水帳分錄 ----------
export type LedgerEntry = {
  id: string;
  source: "FINANCE" | "PAYMENT";
  date: string;
  year: number;
  entryKind: FinanceEntryKindT;
  account: FinanceAccountT;
  direction: FinanceDirectionT;
  amount: number;
  category: string;
  description: string | null;
  activityId: string | null;
  activityLabel: string | null;
  operator: string | null;
  status: "DRAFT" | "CONFIRMED" | "VOID" | "COMPLETED";
  isHistorical: boolean;
  ref: string | null;
  transferGroupId: string | null;
  correctsRecordId: string | null;
};

export type LedgerFilters = {
  from?: string;
  to?: string;
  year?: number;
  account?: FinanceAccountT;
  entryKind?: FinanceEntryKindT;
  templeEventId?: string;
  includeVoid?: boolean;
  includePayments?: boolean;
};

function toCalcLines(entries: LedgerEntry[]): CalcLine[] {
  return entries
    .filter((e) => e.status !== "VOID")
    .map((e) => ({
      account: e.account,
      direction: e.direction,
      amount: e.amount,
      entryKind: e.entryKind,
      isHistorical: e.isHistorical,
      date: e.date,
    }));
}

async function activityLabelMap(ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const events = await prisma.templeEvent.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return new Map(events.map((e) => [e.id, e.name]));
}

function financeRowToEntry(r: FinanceRecordRow, activityLabel: string | null): LedgerEntry {
  const date = toISODate(r.occurredOn);
  return {
    id: r.id,
    source: "FINANCE",
    date,
    year: r.year ?? rocYearOf(date),
    entryKind: (r.entryKind ?? (r.type === "INCOME" ? "INCOME" : "EXPENSE")) as FinanceEntryKindT,
    account: (r.account ?? "CASH") as FinanceAccountT,
    direction: (r.direction ?? (r.type === "INCOME" ? "IN" : "OUT")) as FinanceDirectionT,
    amount: round2(Number(r.amount)),
    category: r.category ?? (r.type === "INCOME" ? "收入" : "支出"),
    description: r.description,
    activityId: r.templeEventId,
    activityLabel,
    operator: r.createdByName,
    status: r.status,
    isHistorical: r.isHistorical,
    ref: null,
    transferGroupId: r.transferGroupId,
    correctsRecordId: r.correctsRecordId,
  };
}

/**
 * 統一流水帳：FinanceRecord ∪ 活動收款（PaymentTransaction COMPLETED）。
 * 依帳務日期新到舊排序。
 */
export async function listLedger(filters: LedgerFilters = {}): Promise<LedgerEntry[]> {
  const includePayments = filters.includePayments !== false;

  const frWhere: Record<string, unknown> = {};
  if (!filters.includeVoid) frWhere.status = { not: "VOID" };
  if (filters.account) frWhere.account = filters.account;
  if (filters.entryKind) frWhere.entryKind = filters.entryKind;
  if (filters.year) frWhere.year = filters.year;
  if (filters.templeEventId) frWhere.templeEventId = filters.templeEventId;
  if (filters.from || filters.to) {
    frWhere.occurredOn = {
      ...(filters.from ? { gte: parseISODate(filters.from) } : {}),
      ...(filters.to ? { lte: parseISODate(filters.to) } : {}),
    };
  }

  const frRows = await financeRecords().findMany({ where: frWhere, orderBy: { occurredOn: "desc" } });
  const labels = await activityLabelMap(frRows.map((r) => r.templeEventId ?? "").filter(Boolean));
  const financeEntries = frRows.map((r) => financeRowToEntry(r, r.templeEventId ? labels.get(r.templeEventId) ?? null : null));

  let paymentEntries: LedgerEntry[] = [];
  // 活動收款只算收入；若指定 entryKind 非 INCOME 或 templeEventId，則不併入付款。
  const wantPayments =
    includePayments && !filters.templeEventId && (!filters.entryKind || filters.entryKind === "INCOME");
  if (wantPayments) {
    const payWhere: Record<string, unknown> = { status: "COMPLETED" };
    if (filters.from || filters.to) {
      payWhere.paidOn = {
        ...(filters.from ? { gte: parseISODate(filters.from) } : {}),
        ...(filters.to ? { lte: parseISODate(filters.to) } : {}),
      };
    }
    const payments = await prisma.paymentTransaction.findMany({ where: payWhere, orderBy: { paidOn: "desc" } });
    paymentEntries = payments
      .map((t): LedgerEntry => {
        const date = toISODate(t.paidOn);
        return {
          id: t.id,
          source: "PAYMENT",
          date,
          year: rocYearOf(date),
          entryKind: "INCOME",
          account: accountForPaymentMethod(t.methodType),
          direction: "IN",
          amount: round2(Number(t.totalAmount)),
          category: "活動收款",
          description: `${t.payerNameSnapshot}｜${t.transactionNo}`,
          activityId: null,
          activityLabel: null,
          operator: t.collectedByName ?? t.createdByName ?? null,
          status: "COMPLETED",
          isHistorical: false,
          ref: t.transactionNo,
          transferGroupId: null,
          correctsRecordId: null,
        };
      })
      .filter((e) => (filters.account ? e.account === filters.account : true))
      .filter((e) => (filters.year ? e.year === filters.year : true));
  }

  return [...financeEntries, ...paymentEntries].sort((a, b) =>
    a.date < b.date ? 1 : a.date > b.date ? -1 : 0
  );
}

// ---------- 餘額與首頁摘要 ----------
export async function getBalances(asOf?: string): Promise<Balances> {
  const lines = await listLedger({});
  return computeBalances(toCalcLines(lines), asOf);
}

export type FinanceHomeSummary = {
  totalBalance: number; // 總結餘 = 銀行 + 現金
  bank: number;
  cash: number;
  todayIncome: number;
  todayExpense: number;
  todayNet: number;
  totalReceivable: number; // 應收總額（未收）
  totalReceived: number; // 已收總額（本年度活動收款）
};

export async function getFinanceHomeSummary(now: Date = new Date()): Promise<FinanceHomeSummary> {
  const today = localTodayISO(now);
  const rocYear = rocYearNow(now);
  const [lines, collection] = await Promise.all([listLedger({}), getCollectionHomeSummary(rocYear, now)]);
  const calc = toCalcLines(lines);
  const balances = computeBalances(calc);
  const totalReceived = round2(
    lines.filter((e) => e.source === "PAYMENT" && e.year === rocYear).reduce((s, e) => s + e.amount, 0)
  );
  return {
    totalBalance: balances.total,
    bank: balances.bank,
    cash: balances.cash,
    todayIncome: sumIncome(calc, today, today),
    todayExpense: sumExpense(calc, today, today),
    todayNet: round2(sumIncome(calc, today, today) - sumExpense(calc, today, today)),
    totalReceivable: collection.pendingReceivableAmount,
    totalReceived,
  };
}

// ---------- 建立紀錄 ----------
export type Operator = { id: string | null; name: string };

type CreateEntryInput = {
  account: FinanceAccountT;
  amount: number;
  category: string;
  occurredOn: string;
  description?: string | null;
  templeEventId?: string | null;
  operator: Operator;
  status?: "DRAFT" | "CONFIRMED";
};

async function insertFinanceRecord(
  input: CreateEntryInput & { type: "INCOME" | "EXPENSE"; entryKind: FinanceEntryKindT; direction: FinanceDirectionT; isHistorical?: boolean; transferGroupId?: string; reconciliationId?: string; correctsRecordId?: string },
  delegate = financeRecords()
): Promise<FinanceRecordRow> {
  return delegate.create({
    data: {
      type: input.type,
      category: input.category,
      amount: round2(input.amount),
      occurredOn: parseISODate(input.occurredOn),
      description: input.description ?? null,
      status: input.status ?? "CONFIRMED",
      account: input.account,
      entryKind: input.entryKind,
      direction: input.direction,
      year: rocYearOf(input.occurredOn),
      templeEventId: input.templeEventId ?? null,
      transferGroupId: input.transferGroupId ?? null,
      reconciliationId: input.reconciliationId ?? null,
      correctsRecordId: input.correctsRecordId ?? null,
      isHistorical: input.isHistorical ?? false,
      createdById: input.operator.id,
      createdByName: input.operator.name,
    },
  });
}

export async function createIncome(input: CreateEntryInput): Promise<FinanceRecordRow> {
  if (!(input.amount > 0)) throw new Error("金額必須大於 0");
  return insertFinanceRecord({ ...input, type: "INCOME", entryKind: "INCOME", direction: "IN" });
}

export async function createExpense(input: CreateEntryInput): Promise<FinanceRecordRow> {
  if (!(input.amount > 0)) throw new Error("金額必須大於 0");
  return insertFinanceRecord({ ...input, type: "EXPENSE", entryKind: "EXPENSE", direction: "OUT" });
}

/**
 * V38 清空財務中心並重設期初（僅供初次設定／測試後重來，最高管理員）。
 * 硬刪除**所有** FinanceRecord（含測試／系統範例），再建立乾淨的兩筆期初（銀行／現金）。
 * ⚠️ 不影響 PaymentTransaction（活動收款）——那是另一套，不在此表。
 */
export async function resetFinanceCenter(input: {
  bankOpening: number;
  cashOpening: number;
  openingDate?: string;
  operator: Operator;
}): Promise<{ deleted: number; bankId: string; cashId: string }> {
  const date = input.openingDate ?? localTodayISO();
  return prisma.$transaction(async (tx) => {
    const del = financeRecordsTx(tx);
    const txDelete = (tx as unknown as { financeRecord: { deleteMany: (args?: unknown) => Promise<{ count: number }> } }).financeRecord;
    const { count } = await txDelete.deleteMany({});
    const mkOpening = (account: FinanceAccountT, amount: number, label: string) =>
      del.create({
        data: {
          type: "INCOME", category: label, amount: round2(Math.max(0, amount)),
          occurredOn: parseISODate(date), description: null, status: "CONFIRMED",
          account, entryKind: "OPENING", direction: "IN", year: rocYearOf(date),
          isHistorical: false, createdById: input.operator.id, createdByName: input.operator.name,
        },
      });
    const bank = await mkOpening("BANK", input.bankOpening, "期初餘額－銀行");
    const cash = await mkOpening("CASH", input.cashOpening, "期初餘額－現金");
    return { deleted: count, bankId: bank.id, cashId: cash.id };
  });
}

/** V38 批次記帳：一次貼上多筆（現金為主）。account 預設 CASH。 */
export type BatchFinanceRow = {
  occurredOn: string; // YYYY-MM-DD
  kind: "INCOME" | "EXPENSE";
  account?: FinanceAccountT;
  category: string;
  amount: number;
  description?: string | null;
};

export async function batchImportFinance(
  rows: BatchFinanceRow[],
  operator: Operator
): Promise<{ created: number }> {
  const valid = rows.filter((r) => r.amount > 0 && /^\d{4}-\d{2}-\d{2}$/.test(r.occurredOn));
  if (valid.length === 0) return { created: 0 };
  await prisma.$transaction(async (tx) => {
    const del = financeRecordsTx(tx);
    for (const r of valid) {
      await del.create({
        data: {
          type: r.kind,
          category: (r.category || "其他").trim(),
          amount: round2(r.amount),
          occurredOn: parseISODate(r.occurredOn),
          description: r.description?.trim() || null,
          status: "CONFIRMED",
          account: r.account ?? "CASH",
          entryKind: r.kind === "INCOME" ? "INCOME" : "EXPENSE",
          direction: r.kind === "INCOME" ? "IN" : "OUT",
          year: rocYearOf(r.occurredOn),
          isHistorical: false,
          createdById: operator.id,
          createdByName: operator.name,
        },
      });
    }
  });
  return { created: valid.length };
}

/** 資金轉移：現金↔銀行。兩腳同一交易，不計收入/支出，只改帳戶餘額。 */
export async function createTransfer(input: {
  fromAccount: FinanceAccountT;
  toAccount: FinanceAccountT;
  amount: number;
  occurredOn: string;
  description?: string | null;
  operator: Operator;
}): Promise<{ transferGroupId: string; out: FinanceRecordRow; in: FinanceRecordRow }> {
  if (input.fromAccount === input.toAccount) throw new Error("轉出與轉入帳戶不可相同");
  if (!(input.amount > 0)) throw new Error("金額必須大於 0");
  const transferGroupId = `tf_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const fromLabel = input.fromAccount === "CASH" ? "現金" : "銀行";
  const toLabel = input.toAccount === "CASH" ? "現金" : "銀行";
  return prisma.$transaction(async (tx) => {
    const del = financeRecordsTx(tx);
    const out = await insertFinanceRecord(
      {
        account: input.fromAccount,
        amount: input.amount,
        category: `資金轉移－轉出（${fromLabel}→${toLabel}）`,
        occurredOn: input.occurredOn,
        description: input.description ?? null,
        operator: input.operator,
        type: "EXPENSE",
        entryKind: "TRANSFER_OUT",
        direction: "OUT",
        transferGroupId,
      },
      del
    );
    const inLeg = await insertFinanceRecord(
      {
        account: input.toAccount,
        amount: input.amount,
        category: `資金轉移－轉入（${fromLabel}→${toLabel}）`,
        occurredOn: input.occurredOn,
        description: input.description ?? null,
        operator: input.operator,
        type: "INCOME",
        entryKind: "TRANSFER_IN",
        direction: "IN",
        transferGroupId,
      },
      del
    );
    return { transferGroupId, out, in: inLeg };
  });
}

/** 現金盤點／銀行對帳：記錄差額並以 ADJUSTMENT 分錄修正（不直接改餘額）。 */
export async function createReconciliation(input: {
  account: FinanceAccountT;
  countedAmount: number;
  occurredOn: string;
  note?: string | null;
  operator: Operator;
}): Promise<{ reconciliationId: string; systemAmount: number; countedAmount: number; difference: number; adjustmentRecordId: string | null }> {
  const balances = await getBalances(input.occurredOn);
  const systemAmount = input.account === "BANK" ? balances.bank : balances.cash;
  const difference = round2(input.countedAmount - systemAmount);

  return prisma.$transaction(async (tx) => {
    const recon = await financeReconciliationsTx(tx).create({
      data: {
        account: input.account,
        occurredOn: parseISODate(input.occurredOn),
        systemAmount,
        countedAmount: round2(input.countedAmount),
        difference,
        note: input.note ?? null,
        createdById: input.operator.id,
        createdByName: input.operator.name,
      },
    });

    let adjustmentRecordId: string | null = null;
    if (difference !== 0) {
      const adj = await insertFinanceRecord(
        {
          account: input.account,
          amount: Math.abs(difference),
          category: `盤點調整（${input.account === "CASH" ? "現金盤點" : "銀行對帳"}）`,
          occurredOn: input.occurredOn,
          description: `系統 ${systemAmount}／盤點 ${round2(input.countedAmount)}／差額 ${difference}${input.note ? `｜${input.note}` : ""}`,
          operator: input.operator,
          type: difference > 0 ? "INCOME" : "EXPENSE",
          entryKind: "ADJUSTMENT",
          direction: difference > 0 ? "IN" : "OUT",
          reconciliationId: recon.id,
        },
        financeRecordsTx(tx)
      );
      adjustmentRecordId = adj.id;
    }
    return { reconciliationId: recon.id, systemAmount, countedAmount: round2(input.countedAmount), difference, adjustmentRecordId };
  });
}

/** 作廢一筆流水帳（不刪除；資料保留）。 */
export async function voidFinanceRecord(id: string, reason: string, operator: Operator): Promise<FinanceRecordRow> {
  return financeRecords().update({
    where: { id },
    data: { status: "VOID", voidedAt: new Date(), voidedById: operator.id, voidedByName: operator.name, voidReason: reason },
  });
}

/** 更正：作廢原紀錄並新增一筆修正紀錄（correctsRecordId 指向原紀錄）。 */
export async function correctFinanceRecord(
  originalId: string,
  next: CreateEntryInput & { type: "INCOME" | "EXPENSE"; entryKind?: FinanceEntryKindT; direction?: FinanceDirectionT },
  operator: Operator
): Promise<{ voided: FinanceRecordRow; created: FinanceRecordRow }> {
  return prisma.$transaction(async (tx) => {
    const del = financeRecordsTx(tx);
    const voided = await del.update({
      where: { id: originalId },
      data: { status: "VOID", voidedAt: new Date(), voidedById: operator.id, voidedByName: operator.name, voidReason: "更正－已由修正紀錄取代" },
    });
    const created = await insertFinanceRecord(
      {
        ...next,
        entryKind: next.entryKind ?? (next.type === "INCOME" ? "INCOME" : "EXPENSE"),
        direction: next.direction ?? (next.type === "INCOME" ? "IN" : "OUT"),
        correctsRecordId: originalId,
        operator,
      },
      del
    );
    return { voided, created };
  });
}

// ---------- 報表（月／年／自訂）＝匯出共用查詢來源 ----------
export type FinanceReport = {
  range: { from: string; to: string; label: string };
  opening: Balances;
  closing: Balances;
  income: number;
  expense: number;
  net: number;
  bankMovement: { inflow: number; outflow: number; net: number };
  cashMovement: { inflow: number; outflow: number; net: number };
  incomeEntries: LedgerEntry[];
  expenseEntries: LedgerEntry[];
  activityBreakdown: { activityId: string; activityLabel: string; income: number; expense: number; net: number }[];
  ledger: LedgerEntry[];
};

export async function getFinanceReport(from: string, to: string, label?: string): Promise<FinanceReport> {
  const all = await listLedger({}); // 全期，供期初/期末餘額計算
  const calcAll = toCalcLines(all);
  const range = all.filter((e) => e.date >= from && e.date <= to && e.status !== "VOID");

  const opening = computeBalances(calcAll, dayBefore(from));
  const closing = computeBalances(calcAll, to);
  const income = sumIncome(calcAll, from, to);
  const expense = sumExpense(calcAll, from, to);

  const incomeEntries = range.filter((e) => e.entryKind === "INCOME" && !e.isHistorical);
  const expenseEntries = range.filter((e) => e.entryKind === "EXPENSE" && !e.isHistorical);

  const actMap = new Map<string, { activityId: string; activityLabel: string; income: number; expense: number }>();
  for (const e of range) {
    if (!e.activityId || e.isHistorical) continue;
    const cur = actMap.get(e.activityId) ?? { activityId: e.activityId, activityLabel: e.activityLabel ?? e.activityId, income: 0, expense: 0 };
    if (e.entryKind === "INCOME") cur.income = round2(cur.income + e.amount);
    else if (e.entryKind === "EXPENSE") cur.expense = round2(cur.expense + e.amount);
    actMap.set(e.activityId, cur);
  }

  return {
    range: { from, to, label: label ?? `${from} ~ ${to}` },
    opening,
    closing,
    income,
    expense,
    net: round2(income - expense),
    bankMovement: accountMovement(calcAll, "BANK", from, to),
    cashMovement: accountMovement(calcAll, "CASH", from, to),
    incomeEntries,
    expenseEntries,
    activityBreakdown: [...actMap.values()].map((a) => ({ ...a, net: round2(a.income - a.expense) })),
    ledger: range,
  };
}

/** 月報：民國年＋月。 */
export function monthRange(rocYear: number, month: number): { from: string; to: string; label: string } {
  const gy = rocYear + 1911;
  const from = `${gy}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(gy, month, 0)).getUTCDate();
  const to = `${gy}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { from, to, label: `民國 ${rocYear} 年 ${month} 月` };
}

/** 年報：民國年。 */
export function yearRange(rocYear: number): { from: string; to: string; label: string } {
  const gy = rocYear + 1911;
  return { from: `${gy}-01-01`, to: `${gy}-12-31`, label: `民國 ${rocYear} 年` };
}

/**
 * 由查詢參數解析報表區間（月／年／自訂）。報表 API 與匯出 API 共用此單一來源。
 * mode=month&rocYear=115&month=8 | mode=year&rocYear=115 | mode=custom&from=..&to=..
 */
export function resolveReportRange(u: URLSearchParams): { from: string; to: string; label: string } | null {
  const mode = u.get("mode") ?? "month";
  const rocYear = u.get("rocYear") ? Number(u.get("rocYear")) : rocYearNow();
  if (mode === "year") return yearRange(rocYear);
  if (mode === "custom") {
    const from = u.get("from") ?? "";
    const to = u.get("to") ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
    return { from, to, label: `${from} ~ ${to}` };
  }
  const month = u.get("month") ? Number(u.get("month")) : new Date().getMonth() + 1;
  if (!(month >= 1 && month <= 12)) return null;
  return monthRange(rocYear, month);
}
