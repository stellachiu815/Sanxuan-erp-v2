import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V21.1 列印流程正式修正——結構驗證（沙盒可執行）。
 *
 * 核心不變式：列印／補印一律「先預覽 → 確認 → 開始列印 → 完成列印後才更新
 * printCount／lastPrintedAt／printedBy」。只開預覽／取消／瀏覽不得增加任何列印紀錄。
 * 沿用既有 Print Center／Template／Print API，不建第二套路由、不改付款/收據/交易/帳本。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("RosterPrintButton：先確認再列印，且列印動作在更新紀錄之前", () => {
  const s = read("src/components/print/RosterPrintButton.tsx");
  // 有「確認 → 開始列印」兩段流程。
  assert.ok(s.includes("confirming"), "有確認狀態");
  assert.ok(s.includes("開始列印"), "有『開始列印』動作");
  // window.print() 必須出現在 mark-printed 之前（先實體列印、後更新列印紀錄）。
  const printPos = s.indexOf("window.print()");
  const markPos = s.indexOf("mark-printed");
  assert.ok(printPos > -1 && markPos > -1 && printPos < markPos, "先 window.print() 再更新列印紀錄");
});

test("名冊頁改用 RosterPrintButton（不再一按即記錄）", () => {
  const page = read("src/app/print-center/rosters/[itemKey]/[year]/page.tsx");
  assert.ok(page.includes("RosterPrintButton"), "使用 RosterPrintButton 元件");
  // 頁面本身不得再於按鈕 onClick 內直接呼叫 mark-printed（改由元件在列印後才記錄）。
  assert.ok(!/onClick=\{async[^}]*mark-printed/.test(page.replace(/\s+/g, " ")), "頁面按鈕不再一按即 mark-printed");
});

test("普渡列印管理：列印／補印先進入確認，開始列印後才更新次數", () => {
  const s = read("src/components/ritual/PrintManagementCenter.tsx");
  assert.ok(s.includes("pending") && s.includes("開始列印"), "有待列印確認與『開始列印』");
  assert.ok(s.includes("requestPrint") && s.includes("confirmPrint"), "拆分為請求列印與確認列印");
  // window.print() 在呼叫列印 API（更新次數）之前。
  const flat = s.replace(/\s+/g, " ");
  const printPos = flat.indexOf("window.print()");
  const apiPos = flat.indexOf("/api/print-center/items/print");
  assert.ok(printPos > -1 && apiPos > -1 && printPos < apiPos, "先列印再更新列印次數");
});

test("每筆 👁 預覽依型別走正式列印模板對照表（不寫死、不導向管理頁）", () => {
  const s = read("src/components/ritual/PrintManagementCenter.tsx");
  assert.ok(s.includes("預覽"), "有預覽入口");
  assert.ok(s.includes("previewRouteForPrintObject"), "預覽路由來自共用對照表");
  // 不得再把所有預覽寫死導向普渡列印物件管理頁。
  assert.ok(!/href=\{`\/universal-salvation\/\$\{it\.year\}\/print-center`\}/.test(s), "預覽不再一律指向管理頁");
});

test("列印紀錄顯示首印／最後補印／總次數／操作人／使用模板", () => {
  const page = read("src/app/print-center/rosters/[itemKey]/[year]/page.tsx");
  for (const w of ["已列印", "首印", "最後", "使用模板"]) assert.ok(page.includes(w), `名冊列印紀錄應含 ${w}`);
  assert.ok(page.includes("printCount") && page.includes("printedByName"), "含次數與操作人欄位");
  const center = read("src/components/ritual/PrintManagementCenter.tsx");
  for (const w of ["首次", "最後", "操作人"]) assert.ok(center.includes(w), `列印管理列印紀錄應含 ${w}`);
});

test("不改付款/收據/交易/帳本、不建第二套列印路由", () => {
  const btn = read("src/components/print/RosterPrintButton.tsx");
  const center = read("src/components/ritual/PrintManagementCenter.tsx");
  for (const s of [btn, center]) {
    assert.doesNotMatch(s, /amountDue|amountPaid|receiptNumber|paymentTransaction|ledger/i);
    assert.doesNotMatch(s, /printSystem2|secondPrint|reprintTransaction|reprintPayment/i);
  }
  // 仍沿用既有 mark-printed／items/print API，不新增列印資料表。
  assert.ok(btn.includes("mark-printed"), "沿用既有 mark-printed API");
  assert.ok(center.includes("/api/print-center/items/print"), "沿用既有 items/print API");
});
