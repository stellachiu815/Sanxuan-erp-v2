import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * V23 使用者/角色/權限總驗收——API 權限覆蓋、角色可指派性、稽核機制（來源掃描，沙盒可執行）。
 * 不修改權限/Session/Operator 架構，只驗證現況並防止回歸。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const API_ROOT = join(process.cwd(), "src/app/api");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

/**
 * 已知「不以 route 層 assert 包裝、但仍有防護或無需防護」的寫入路由（誠實登錄）：
 *   - 權限在 service 層落實（voidReceipt/restoreFromBackup 內部查 resolveOperator+canX）。
 *   - 或為無資料寫入的純工具（birthday 日期換算）。
 * 若日後新增未防護的寫入路由，本測試會失敗，提醒補上檢查。
 */
const SERVICE_ENFORCED_OR_STATELESS = new Set([
  "birthday/convert/route.ts", // 無 DB 寫入的純換算
  "receipt-center/receipts/[id]/void/route.ts", // voidReceipt() 內部查證角色
  "receipt-center/receipts/[id]/reissue/route.ts", // reissueReceipt() 內部查證
  "receipt-center/allocations/[id]/mark-no-receipt-required/route.ts", // service 內部查證
  "receipt-center/receipts/[id]/revoke-no-receipt-required/route.ts", // service 內部查證
  "system-center/backup/restore/route.ts", // restoreFromBackup() 內部查 restoreBackup 權限
  "public-reg/[slug]/submit/route.ts", // V38 信眾公開報名送出：刻意免登入（信眾自填），只寫入「待確認」、不建正式牌位；有必填檢查＋IP+姓名 30 秒防重複
]);

test("所有寫入 API 皆有權限防護（route 層 assert 或 service 層查證），無裸露寫入端點", () => {
  const routes = walk(API_ROOT);
  const unprotected: string[] = [];
  for (const f of routes) {
    const s = readFileSync(f, "utf8");
    if (!/export async function (POST|PUT|PATCH|DELETE)/.test(s)) continue;
    const rel = f.slice(API_ROOT.length + 1);
    const hasAssert = /assert[A-Za-z]*Permission/.test(s);
    const isScheduled = /SCHEDULED_TRIGGER|scheduled-trigger/.test(s);
    const isAuth = rel.startsWith("auth/login") || rel.startsWith("auth/logout");
    if (hasAssert || isScheduled || isAuth) continue;
    if (SERVICE_ENFORCED_OR_STATELESS.has(rel)) continue;
    unprotected.push(rel);
  }
  assert.deepEqual(unprotected, [], `發現未防護的寫入 API：\n${unprotected.join("\n")}`);
});

test("維持四種正式角色：使用者建立/修改 API 皆拒絕指派 FINANCE_CLERK，UI 只列四種", () => {
  const createApi = read("src/app/api/system-center/users/route.ts");
  const updateApi = read("src/app/api/system-center/users/[id]/route.ts");
  assert.ok(/role === "FINANCE_CLERK"[\s\S]{0,120}(不開放|尚未啟用)/.test(createApi), "建立 API 拒絕 FINANCE_CLERK");
  assert.ok(/role === "FINANCE_CLERK"[\s\S]{0,120}(不開放|尚未啟用)/.test(updateApi), "修改 API 拒絕 FINANCE_CLERK");
  const ui = read("src/app/system-center/users/page.tsx");
  const optionBlock = ui.slice(ui.indexOf("ROLE_OPTIONS"), ui.indexOf("ROLE_OPTIONS") + 400);
  for (const r of ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY"]) assert.ok(optionBlock.includes(r), `UI 應含 ${r}`);
  assert.ok(!optionBlock.includes("FINANCE_CLERK"), "UI 角色選項不得含 FINANCE_CLERK");
});

test("最後一位最高管理員保護：不可降級/停用最後一位 active SUPER_ADMIN", () => {
  const updateApi = read("src/app/api/system-center/users/[id]/route.ts");
  assert.ok(/wouldRemoveLastActiveSuperAdmin|最後一位最高管理員/.test(updateApi), "有最後管理員防鎖");
});

test("稽核機制：財務/登入/帳號密碼寫 AuditLog；收據/信眾用 RecordVersion；收款於紀錄本身留操作人", () => {
  // AuditLog（操作人、時間、內容、前後差異）
  for (const f of ["src/app/api/finance-center/records/route.ts", "src/app/api/finance-center/records/void/route.ts", "src/app/api/finance-center/transfers/route.ts", "src/app/api/finance-center/reconciliations/route.ts", "src/app/api/finance-center/records/correct/route.ts", "src/app/api/auth/login/route.ts"]) {
    assert.ok(read(f).includes("auditLog.create"), `${f} 應寫 AuditLog`);
  }
  // RecordVersion（前後差異）
  assert.ok(read("src/lib/receipt.ts").includes("recordVersion"), "收據用 RecordVersion");
  // 收款：操作人/時間/作廢原因留在 PaymentTransaction 本身
  const cc = read("src/lib/collectionCenter.ts");
  assert.ok(cc.includes("collectedByName") && cc.includes("voidedByName"), "收款/作廢於紀錄留操作人");
});

test("操作人一律以 session 為準（readOperatorUserId），不信任前端傳入的操作人姓名", () => {
  const ro = read("src/lib/requestOperator.ts");
  assert.ok(ro.includes("getSessionUserByToken") || ro.includes("SESSION_COOKIE"), "operatorUserId 來自 session");
  // operator.ts 由 userId 查資料庫取角色，不信任 client role
  const op = read("src/lib/operator.ts");
  assert.ok(op.includes("resolveOperator") && op.includes("prisma.user.findUnique"), "角色由 DB 查得");
});
