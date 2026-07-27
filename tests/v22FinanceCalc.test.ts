import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBalances, sumIncome, sumExpense, netAmount, accountMovement, type CalcLine } from "../src/lib/financeCalc";

/**
 * V22 財務中心純計算驗收：
 *  - 總結餘 = 銀行 + 現金
 *  - 期初現金 25,778、銀行 1,742,325、總結餘 1,768,103
 *  - 7/29 支出 8,232 為歷史備查（isHistorical），不影響餘額與支出合計
 *  - 資金轉移不計收入/支出，只改帳戶餘額
 *  - 盤點調整（ADJUSTMENT）改餘額、不計收支
 *  - 活動收款（INCOME）付款完成即計入餘額與收入
 */

const opening: CalcLine[] = [
  { account: "BANK", direction: "IN", amount: 1742325, entryKind: "OPENING", isHistorical: false, date: "2026-07-31" },
  { account: "CASH", direction: "IN", amount: 25778, entryKind: "OPENING", isHistorical: false, date: "2026-07-31" },
];

const historical729: CalcLine[] = [
  { account: "CASH", direction: "OUT", amount: 800, entryKind: "EXPENSE", isHistorical: true, date: "2026-07-29" },
  { account: "CASH", direction: "OUT", amount: 289, entryKind: "EXPENSE", isHistorical: true, date: "2026-07-29" },
  { account: "CASH", direction: "OUT", amount: 6340, entryKind: "EXPENSE", isHistorical: true, date: "2026-07-29" },
  { account: "CASH", direction: "OUT", amount: 593, entryKind: "EXPENSE", isHistorical: true, date: "2026-07-29" },
  { account: "CASH", direction: "OUT", amount: 210, entryKind: "EXPENSE", isHistorical: true, date: "2026-07-29" },
];

test("期初餘額：總結餘 = 銀行 + 現金 = 1,768,103", () => {
  const b = computeBalances(opening);
  assert.equal(b.bank, 1742325);
  assert.equal(b.cash, 25778);
  assert.equal(b.total, 1768103);
});

test("7/29 支出合計 8,232，但為歷史備查：不影響餘額、不計入支出合計", () => {
  const lines = [...opening, ...historical729];
  const b = computeBalances(lines);
  assert.equal(b.cash, 25778, "現金仍為期初 25,778（不重複扣款）");
  assert.equal(b.total, 1768103);
  assert.equal(sumExpense(lines), 0, "歷史備查不計入支出合計");
  // 但金額本身確實是 8,232（資料仍在，供流水帳查詢）。
  assert.equal(historical729.reduce((s, l) => s + l.amount, 0), 8232);
});

test("活動收款（INCOME）付款完成即入帳：計入餘額與收入", () => {
  const lines: CalcLine[] = [
    ...opening,
    { account: "CASH", direction: "IN", amount: 3000, entryKind: "INCOME", isHistorical: false, date: "2026-08-01" },
    { account: "BANK", direction: "IN", amount: 5000, entryKind: "INCOME", isHistorical: false, date: "2026-08-01" },
  ];
  const b = computeBalances(lines);
  assert.equal(b.cash, 28778);
  assert.equal(b.bank, 1747325);
  assert.equal(sumIncome(lines), 8000);
});

test("一般支出計入餘額與支出合計、淨額 = 收入 − 支出", () => {
  const lines: CalcLine[] = [
    ...opening,
    { account: "CASH", direction: "IN", amount: 1000, entryKind: "INCOME", isHistorical: false, date: "2026-08-02" },
    { account: "CASH", direction: "OUT", amount: 400, entryKind: "EXPENSE", isHistorical: false, date: "2026-08-02" },
  ];
  assert.equal(sumIncome(lines), 1000);
  assert.equal(sumExpense(lines), 400);
  assert.equal(netAmount(lines), 600);
  assert.equal(computeBalances(lines).cash, 25778 + 1000 - 400);
});

test("資金轉移：現金→銀行，不計收支，只改帳戶餘額，總結餘不變", () => {
  const lines: CalcLine[] = [
    ...opening,
    { account: "CASH", direction: "OUT", amount: 20000, entryKind: "TRANSFER_OUT", isHistorical: false, date: "2026-08-03" },
    { account: "BANK", direction: "IN", amount: 20000, entryKind: "TRANSFER_IN", isHistorical: false, date: "2026-08-03" },
  ];
  const b = computeBalances(lines);
  assert.equal(b.cash, 25778 - 20000);
  assert.equal(b.bank, 1742325 + 20000);
  assert.equal(b.total, 1768103, "轉移不改總結餘");
  assert.equal(sumIncome(lines), 0, "轉入不計收入");
  assert.equal(sumExpense(lines), 0, "轉出不計支出");
});

test("盤點調整（ADJUSTMENT）：改餘額、不計收支", () => {
  const lines: CalcLine[] = [
    ...opening,
    { account: "CASH", direction: "OUT", amount: 78, entryKind: "ADJUSTMENT", isHistorical: false, date: "2026-08-04" },
  ];
  assert.equal(computeBalances(lines).cash, 25778 - 78);
  assert.equal(sumExpense(lines), 0);
  assert.equal(sumIncome(lines), 0);
});

test("期末餘額以帳務日期累計（asOf）：7/31 之後才承接期初", () => {
  const lines = [...opening, ...historical729];
  // 截至 7/30：只有 7/29 歷史（被排除）→ 0；期初 7/31 尚未計入。
  assert.equal(computeBalances(lines, "2026-07-30").total, 0);
  // 截至 7/31：承接期初。
  assert.equal(computeBalances(lines, "2026-07-31").total, 1768103);
});

test("帳戶異動（銀行/現金 流入/流出/淨）", () => {
  const lines: CalcLine[] = [
    ...opening,
    { account: "CASH", direction: "IN", amount: 500, entryKind: "INCOME", isHistorical: false, date: "2026-08-05" },
    { account: "CASH", direction: "OUT", amount: 200, entryKind: "EXPENSE", isHistorical: false, date: "2026-08-05" },
  ];
  const mv = accountMovement(lines, "CASH", "2026-08-01", "2026-08-31");
  assert.equal(mv.inflow, 500);
  assert.equal(mv.outflow, 200);
  assert.equal(mv.net, 300);
});
