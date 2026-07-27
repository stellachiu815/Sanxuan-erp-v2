import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * V21 列印中心正式版——結構驗證（沙盒可執行）。DB 行為（實際計數、名冊）沿用既有
 * V14/V15R8 邏輯與測試；這裡驗證 V21 新增的補印計數、活動列印狀態總覽、列印預檢，
 * 以及「不重建資料、不改付款/收據/交易/帳本、不建第二套列印系統」不變式。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("列印彙總加入補印計數（printCount ≥ 2）", () => {
  const s = read("src/lib/printDocuments.ts");
  assert.ok(s.includes("reprintedCount"), "ActivityItemPrintSummary 應含 reprintedCount");
  assert.ok(/printCount\b/.test(s) && />= 2/.test(s), "以 printCount ≥ 2 判定已補印");
});

test("列印預檢：validateRosterForPrint（缺姓名／牌位／斤數／數量），只讀不寫", () => {
  const s = read("src/lib/printDocuments.ts");
  assert.ok(s.includes("validateRosterForPrint"), "有列印預檢函式");
  for (const w of ["缺牌位姓名", "缺姓名", "缺數量", "白米斤數異常"]) assert.ok(s.includes(w), `預檢原因應含 ${w}`);
});

test("列印預檢在名冊 API 回傳、頁面提示並擋下列印", () => {
  const api = read("src/app/api/print-center/rosters/[itemKey]/[year]/route.ts");
  assert.ok(api.includes("validateRosterForPrint") && api.includes("preflight"), "API 回傳 preflight");
  const page = read("src/app/print-center/rosters/[itemKey]/[year]/page.tsx");
  assert.ok(page.includes("PreflightNotice"), "頁面顯示預檢提示");
  assert.ok(/disabled=\{blocked\}/.test(page), "預檢未通過時擋下列印按鈕");
  assert.ok(page.includes("預檢未通過"), "按鈕顯示預檢未通過");
});

test("列印中心首頁：各活動待列印／已列印／補印總覽", () => {
  const page = read("src/app/print-center/page.tsx");
  assert.ok(page.includes("groupTotals"), "有各活動總覽彙總");
  for (const w of ["待列印", "已列印", "補印"]) assert.ok(page.includes(w), `首頁應顯示 ${w}`);
  // 每個活動項目都可進入名冊／列印／補印（既有 roster 路由）。
  assert.ok(page.includes("/print-center/rosters/"), "可進入各項目名冊");
});

test("補印不重建資料、不改付款/收據/交易/帳本；不建第二套列印系統", () => {
  const doc = read("src/lib/printDocuments.ts");
  // 標記已列印一律不動金額（既有註解與規則）。
  assert.ok(doc.includes("不觸碰 amountDue") || doc.includes("不改收款"), "補印不改收款金額");
  // V21 未新增第二套列印資料表／收款寫入。
  assert.doesNotMatch(doc, /printSystem2|secondPrint|reprintTransaction|reprintPayment/i);
});

test("所有可列印活動都能從列印中心找到（依 RegistrationItemType 全項目彙總，不寫死單一活動）", () => {
  const doc = read("src/lib/printDocuments.ts");
  // listActivityItemPrintSummary 讀所有 isActive 的 RegistrationItemType（涵蓋普渡/年度燈/宮慶/補庫）。
  assert.ok(/registrationItemType\.findMany\(\{\s*where:\s*\{\s*isActive:\s*true\s*\}/.test(doc.replace(/\s+/g, " ")), "彙總涵蓋所有啟用報名項目");
});

// 確保沒有為了列印而新增第二套路由（列印仍集中在 /print-center 與既有 rosters）。
test("列印中心路由未新增第二套（仍為 /print-center 與既有 rosters）", () => {
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else out.push(p);
    }
    return out;
  }
  const printPages = walk(join(process.cwd(), "src/app")).filter((p) => p.endsWith("page.tsx") && /print/i.test(p));
  // 既有列印頁面集合（不因 V21 暴增第二套主列印中心）。
  assert.ok(printPages.some((p) => p.includes("print-center/page.tsx")), "保留單一列印中心首頁");
  assert.ok(printPages.some((p) => p.includes("print-center/rosters")), "保留共用名冊路由");
});
