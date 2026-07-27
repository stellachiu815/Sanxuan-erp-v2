import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V19「驗收／健康檢查中心」——結構與只讀保證（沙盒可執行）。
 * 實際掃描結果的 DB 行為需真實 Postgres，這裡驗證「只讀、規則代碼唯一、權限把關」不變式。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("scanner 只讀：不得出現任何寫入操作（update/create/delete/upsert/updateMany/...）", () => {
  const src = read("src/lib/acceptanceScanner.ts");
  // 只允許讀取類：findMany / findUnique / findFirst / count / groupBy / aggregate。
  const bannedWrites = [
    ".update(",
    ".updateMany(",
    ".create(",
    ".createMany(",
    ".delete(",
    ".deleteMany(",
    ".upsert(",
    "$executeRaw",
    "$executeRawUnsafe",
  ];
  for (const w of bannedWrites) {
    assert.equal(src.includes(w), false, `scanner 不得包含寫入操作 ${w}`);
  }
});

test("規則代碼唯一且格式固定（模組前綴-序號）", () => {
  const src = read("src/lib/acceptanceScanner.ts");
  const codes = [...src.matchAll(/code:\s*"([A-Z]+-\d{3})"/g)].map((m) => m[1]);
  assert.ok(codes.length >= 15, `規則數量應 ≥ 15，實際 ${codes.length}`);
  assert.equal(new Set(codes).size, codes.length, "規則代碼必須唯一");
});

test("涵蓋所有要求模組（活動/報名/財務/交易/列印/信眾/家戶/帳號權限/系統設定）", () => {
  const src = read("src/lib/acceptanceScanner.ts");
  for (const prefix of ["ACT-", "REG-", "FIN-", "TXN-", "PRN-", "DEV-", "HH-", "SEC-", "SYS-"]) {
    assert.ok(src.includes(`code: "${prefix}`), `缺少模組規則前綴 ${prefix}`);
  }
});

test("嚴重程度含 PASS/WARNING/ERROR/UNKNOWN（無法自動判斷）", () => {
  const src = read("src/lib/acceptanceScanner.ts");
  for (const s of ["PASS", "WARNING", "ERROR", "UNKNOWN"]) {
    assert.ok(src.includes(`"${s}"`), `缺少嚴重程度 ${s}`);
  }
  // 程式碼層檢查以 UNKNOWN 呈現（不偽裝通過）。
  assert.ok(src.includes("unknown("), "程式碼層檢查應以 UNKNOWN 呈現");
});

test("避免 N+1：共用報名項目資料一次載入（buildContext）", () => {
  const src = read("src/lib/acceptanceScanner.ts");
  assert.ok(src.includes("async function buildContext"), "應有 buildContext 共用資料載入");
  assert.ok(/ctx\.items/.test(src), "財務／列印規則應共用 ctx.items，不逐列查詢");
});

test("API 只讀＋權限：runAcceptanceScan 需 Session 且僅 SUPER_ADMIN/ADMIN", () => {
  const api = read("src/app/api/system-center/acceptance-scan/route.ts");
  assert.ok(api.includes("readOperatorUserId"), "operator 取自 Session");
  assert.ok(/assertSystemPermissionForOperator\([\s\S]{0,80}"runAcceptanceScan"\)/.test(api), "以 runAcceptanceScan 權限把關");
  assert.ok(api.includes("runAcceptanceScan()"), "呼叫只讀掃描");
});

test("權限矩陣：runAcceptanceScan 授予 SUPER_ADMIN 與 ADMIN，STAFF/READONLY 無", () => {
  const perm = read("src/lib/permissions.ts");
  assert.ok(/SUPER_ADMIN:\s*\[[\s\S]*runAcceptanceScan[\s\S]*\]/.test(perm), "SUPER_ADMIN 應有 runAcceptanceScan");
  assert.ok(/ADMIN:\s*\[[^\]]*runAcceptanceScan[^\]]*\]/.test(perm), "ADMIN 應有 runAcceptanceScan");
  assert.ok(/STAFF:\s*\[\]/.test(perm), "STAFF 無系統權限");
  assert.ok(/READONLY:\s*\[\]/.test(perm), "READONLY 無系統權限");
});

test("UI 入口：AdminToolsSection 有驗收/健康檢查連結（ADMIN 可見）；頁面 render 掃描畫面", () => {
  const tools = read("src/components/system-center/AdminToolsSection.tsx");
  assert.ok(tools.includes("/system-center/acceptance"), "系統管理工具區有驗收入口");
  assert.ok(tools.includes("runAcceptanceScan"), "以 runAcceptanceScan 權限決定顯示");
  const page = read("src/app/system-center/acceptance/page.tsx");
  assert.ok(page.includes("<AcceptanceScanScreen"), "頁面 render 掃描畫面");
});
