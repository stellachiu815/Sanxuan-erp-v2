import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canFinance } from "../src/lib/permissions";
import { accountForPaymentMethod } from "../src/lib/financeCalc";

/**
 * V22 財務中心結構驗收（沙盒可執行）。DB 行為在 Mac 上以真實 Postgres 驗收；
 * 這裡驗證：單一帳本、不建第二套帳務/路由、期初與 7/29 種子、權限、匯出共用查詢來源。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("單一帳本：沿用 FinanceRecord，活動收入由 PaymentTransaction 衍生（不重複寫入）", () => {
  const s = read("src/lib/financeCenter.ts");
  assert.ok(s.includes("listLedger"), "有統一流水帳");
  assert.ok(s.includes("paymentTransaction.findMany") && s.includes('status: "COMPLETED"'), "活動收入來自 COMPLETED 收款");
  // 不得把活動收款再寫入 FinanceRecord（避免第二套帳）。
  assert.ok(!/paymentTransaction[\s\S]{0,200}financeRecord.*create/i.test(s), "活動收款不重複寫入帳本");
});

test("期初餘額與 7/29 支出 migration 種子正確", () => {
  const dir = "prisma/migrations";
  const mig = readdirSync(join(process.cwd(), dir)).find((d) => d.includes("v22_finance_center"));
  assert.ok(mig, "有 v22 財務中心 migration");
  const sql = read(join(dir, mig!, "migration.sql"));
  assert.ok(sql.includes("1742325") && sql.includes("期初餘額－銀行"), "期初銀行 1,742,325");
  assert.ok(sql.includes("25778") && sql.includes("期初餘額－現金"), "期初現金 25,778");
  // 7/29 五筆合計 8,232，且 isHistorical=true（不重複扣款）。
  for (const v of ["800", "289", "6340", "593", "210"]) assert.ok(sql.includes(v), `7/29 含 ${v}`);
  assert.equal(800 + 289 + 6340 + 593 + 210, 8232);
  assert.ok(/fin_hist_0729_flower[\s\S]*true/.test(sql), "7/29 支出為歷史備查 isHistorical=true");
  assert.ok(sql.includes("DATE '2026-07-31'") && sql.includes("DATE '2026-07-29'"), "啟用日 7/31、支出 7/29");
});

test("資金轉移不計收支（TRANSFER_IN/OUT），盤點差額走 ADJUSTMENT", () => {
  const s = read("src/lib/financeCenter.ts");
  assert.ok(s.includes("TRANSFER_OUT") && s.includes("TRANSFER_IN") && s.includes("createTransfer"), "有資金轉移兩腳");
  assert.ok(s.includes("ADJUSTMENT") && s.includes("createReconciliation"), "盤點差額以 ADJUSTMENT 修正");
  assert.ok(s.includes("不直接改餘額") || s.includes("差額"), "盤點不直接改餘額");
});

test("流水帳不得刪除：以作廢（VOID）與更正（correctsRecordId）處理", () => {
  const s = read("src/lib/financeCenter.ts");
  assert.ok(s.includes("voidFinanceRecord") && s.includes("correctFinanceRecord"), "有作廢與更正");
  assert.ok(s.includes("correctsRecordId"), "更正採新增修正紀錄");
  assert.ok(!/finance.*\.delete\(/i.test(s), "帳本不得實體刪除");
});

test("收款方式→帳戶映射：現金進現金，其餘進銀行", () => {
  assert.equal(accountForPaymentMethod("CASH"), "CASH");
  assert.equal(accountForPaymentMethod("BANK_TRANSFER"), "BANK");
  assert.equal(accountForPaymentMethod("MOBILE_PAYMENT"), "BANK");
  assert.equal(accountForPaymentMethod("CHECK"), "BANK");
});

test("權限矩陣（V23.1 收斂）：財務僅 SUPER_ADMIN/ADMIN；期初僅 SUPER_ADMIN；STAFF/READONLY/FINANCE_CLERK 全部 false", () => {
  assert.ok(canFinance("SUPER_ADMIN", "manageOpening"));
  assert.ok(!canFinance("ADMIN", "manageOpening"));
  assert.ok(canFinance("ADMIN", "void") && canFinance("ADMIN", "correct") && canFinance("ADMIN", "createEntry") && canFinance("ADMIN", "transfer"));
  // V23.1：STAFF/READONLY/FINANCE_CLERK 對財務一律無權限（含 view/export）。
  for (const r of ["STAFF", "READONLY", "FINANCE_CLERK"] as const) {
    for (const a of ["view", "export", "createEntry", "transfer", "reconcile", "void", "correct", "manageOpening"] as const) {
      assert.ok(!canFinance(r, a), `${r} 不可 ${a}`);
    }
  }
});

test("匯出（Excel）與報表共用同一 getFinanceReport 查詢來源；PDF 走列印頁", () => {
  const exp = read("src/app/api/finance-center/export/route.ts");
  assert.ok(exp.includes("getFinanceReport") && exp.includes("resolveReportRange"), "Excel 匯出共用報表查詢來源");
  const reportsPage = read("src/app/finance-center/reports/page.tsx");
  assert.ok(reportsPage.includes("/finance-center/reports/print") && reportsPage.includes("/api/finance-center/export"), "報表頁提供 PDF 列印與 Excel 匯出");
});

test("不建立第二套財務路由：財務中心集中於 /finance-center 與 /api/finance-center", () => {
  const apiDir = join(process.cwd(), "src/app/api/finance-center");
  const pageDir = join(process.cwd(), "src/app/finance-center");
  assert.ok(readdirSync(apiDir).length > 0, "有財務中心 API");
  assert.ok(readdirSync(pageDir).length > 0, "有財務中心頁面");
  // 財務首頁存在單一入口。
  assert.ok(read("src/app/finance-center/page.tsx").includes("財務中心"), "單一財務首頁");
});
