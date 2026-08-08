import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { canFinance, canCollection, canReceipt, type Role } from "../src/lib/permissions";

/**
 * V23.1 財務權限收斂驗收：財務中心一律僅 SUPER_ADMIN / ADMIN。
 * STAFF / READONLY 不得查看、匯出、呼叫任何財務 API；收款/收據等既有權限不受影響。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const FIN_ACTIONS = ["view", "viewFullReport", "create", "update", "void", "export", "createEntry", "transfer", "reconcile", "correct", "manageOpening"] as const;

test("1. SUPER_ADMIN 可使用所有財務 action", () => {
  for (const a of FIN_ACTIONS) assert.ok(canFinance("SUPER_ADMIN", a), `SUPER_ADMIN 應可 ${a}`);
});

test("2/3. ADMIN 財務唯讀（V38）：只可 view/viewFullReport/export，寫入類一律不可", () => {
  const READONLY = new Set(["view", "viewFullReport", "export"]);
  for (const a of FIN_ACTIONS) {
    if (READONLY.has(a)) assert.ok(canFinance("ADMIN", a), `ADMIN 應可（唯讀）${a}`);
    else assert.ok(!canFinance("ADMIN", a), `ADMIN 不可（唯讀）${a}`);
  }
  assert.ok(!canFinance("ADMIN", "manageOpening"), "ADMIN 不可期初餘額");
});

test("4/5. STAFF 與 READONLY 對所有財務 action 都是 false", () => {
  for (const r of ["STAFF", "READONLY"] as Role[]) {
    for (const a of FIN_ACTIONS) assert.ok(!canFinance(r, a), `${r} 不可 ${a}`);
  }
});

test("6. STAFF 仍可依原權限進行活動收款與收據操作（不誤傷）", () => {
  assert.ok(canCollection("STAFF", "recordPayment"), "STAFF 仍可收款");
  assert.ok(canCollection("STAFF", "manageManualReceivable"), "STAFF 仍可臨時應收");
  assert.ok(canReceipt("STAFF", "issue") && canReceipt("STAFF", "print"), "STAFF 仍可開立/列印收據");
});

test("7. 財務導覽給可查看財務者顯示（V38：SUPER_ADMIN 完整＋ADMIN 唯讀；首頁 showFinance＝canFinance('view')）", () => {
  const home = read("src/app/page.tsx");
  assert.ok(home.includes("canFinance") && /showFinance/.test(home), "首頁以 canFinance 決定財務入口");
  // V38：ADMIN 也看得到（唯讀），入口以 canFinance('view') 收斂。
  assert.ok(/showFinance\s*=\s*role\s*\?\s*canFinance\(role,\s*["']view["']\)/.test(home), "財務入口以 canFinance('view') 判斷");
  assert.ok(/\{showFinance && \(/.test(home), "財務連結被 showFinance 包住");
});

test("8. 直接輸入財務網址：伺服器端 layout 以 session 角色阻擋 STAFF/READONLY（非只前端隱藏）", () => {
  const layout = read("src/app/finance-center/layout.tsx");
  assert.ok(layout.includes("getSessionUser") && layout.includes('canFinance'), "layout 用 session 角色 + canFinance 守門");
  assert.ok(!layout.includes('"use client"'), "layout 為 server component（伺服器端阻擋）");
  assert.ok(layout.includes("沒有權限") || layout.includes("僅限"), "無權限時顯示阻擋畫面");
});

test("9. 所有財務 API（含 GET）皆以 assertFinancePermissionForOperator 保護", () => {
  const apiDir = join(process.cwd(), "src/app/api/finance-center");
  function walk(dir: string, out: string[] = []): string[] {
    for (const n of readdirSync(dir)) {
      const p = join(dir, n);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (n === "route.ts") out.push(p);
    }
    return out;
  }
  const routes = walk(apiDir);
  assert.ok(routes.length >= 8, "財務 API 應完整涵蓋");
  for (const f of routes) {
    const s = readFileSync(f, "utf8");
    assert.ok(s.includes("assertFinancePermissionForOperator"), `${f.slice(apiDir.length + 1)} 應有財務權限檢查`);
  }
  // GET 端點（summary/ledger/reports/export）也受保護：view/export 兩個 action，STAFF/READONLY 皆無 → 403。
  assert.ok(!canFinance("STAFF", "view") && !canFinance("READONLY", "view"), "GET 讀取一律擋下 STAFF/READONLY");
  assert.ok(!canFinance("STAFF", "export") && !canFinance("READONLY", "export"), "匯出一律擋下 STAFF/READONLY");
});

test("10. 未動 V22 財務金額計算/期初：financeCalc 與 migration 種子維持原狀", () => {
  const calc = read("src/lib/financeCalc.ts");
  assert.ok(calc.includes("computeBalances") && calc.includes("round2"), "計算函式仍在");
  const dir = "prisma/migrations";
  const mig = readdirSync(join(process.cwd(), dir)).find((d) => d.includes("v22_finance_center"));
  assert.ok(mig, "V22 migration 仍在");
  const sql = read(join(dir, mig!, "migration.sql"));
  assert.ok(sql.includes("1742325") && sql.includes("25778"), "期初餘額種子未變");
});
