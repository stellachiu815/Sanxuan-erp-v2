import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V20 白米管理正式版——結構驗證（沙盒可執行）。DB 行為（即時統計、超額判斷）
 * 沿用 V16 邏輯（tests/v16Rice*.test.ts）；這裡驗證 V20 新增的統計欄位、健康規則、
 * 各處顯示與「不建第二套、不改財務流程」不變式。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("統計即時計算：getRiceQuotaSummary 回傳已收/未收斤數與今年總認購戶數", () => {
  const s = read("src/lib/whiteRiceService.ts");
  for (const f of ["paidKg", "unpaidKg", "householdCount", "overbookedKg", "registeredKg", "remainingKg"]) {
    assert.ok(s.includes(f), `RiceQuotaSummary 應含 ${f}`);
  }
  // 由有效正式報名即時彙總（不快取、不人工維護）。
  assert.ok(/validRiceItemWhere\(event\.year\)/.test(s), "以有效正式白米報名即時彙總");
});

test("活動設定：白米總量（必填）＋是否允許超額，且不影響其他活動", () => {
  const svc = read("src/lib/whiteRiceService.ts");
  // 設定沿用 TempleEvent 既有欄位（riceTotalKg／riceAllowOverbook），單一活動年度。
  assert.ok(svc.includes("riceTotalKg"), "白米總開放斤數欄位");
  assert.ok(svc.includes("allowOverbook"), "是否允許超額");
  const panel = read("src/components/universal-salvation/WhiteRicePanel.tsx");
  assert.ok(panel.includes("年度總量") || panel.includes("白米總開放斤數"), "設定表單有白米總量");
  assert.ok(panel.includes("允許超量認購") || panel.includes("允許超額"), "設定表單有允許超額開關");
});

test("活動管理首頁：普渡活動卡顯示白米資訊，非白米活動不顯示", () => {
  const page = read("src/app/activities/page.tsx");
  assert.ok(page.includes("getRiceQuotaSummary"), "活動列表頁計算白米摘要");
  assert.ok(/activityType === "UNIVERSAL_SALVATION" && e\.riceTotalKg !== null/.test(page), "僅普渡且已設定白米總量");
  const list = read("src/components/activities/ActivityListScreen.tsx");
  assert.ok(list.includes("e.rice") && list.includes("剩餘") && list.includes("今年總認購"), "活動卡顯示白米/剩餘/戶數");
});

test("報名畫面即時顯示：總量／已認購／剩餘／本次", () => {
  const panel = read("src/components/universal-salvation/WhiteRicePanel.tsx");
  for (const w of ["總量", "已認購", "剩餘", "本次"]) assert.ok(panel.includes(w), `報名即時顯示應含 ${w}`);
});

test("收款中心：白米收款顯示認購／已收／未收斤數，且不改收款流程", () => {
  const adp = read("src/lib/receivableAdapters.ts");
  assert.ok(/isRice/.test(adp), "白米來源以 isRice 旗標特別顯示");
  assert.ok(adp.includes("認購") && adp.includes("已收") && adp.includes("未收") && adp.includes("斤"), "顯示斤數");
  // 沿用同一 adapter／同一 ritual_registration_items，不建第二套收款。
  assert.ok(adp.includes('makeRegistrationItemAdapter("RICE_REGISTRATION", ["US_RICE"], "白米登記", true)'), "沿用既有 registration item adapter");
});

test("健康檢查新增 RICE-001..004（總量未設定／超額／斤數異常／應收與斤數不一致），僅提示不修正", () => {
  const s = read("src/lib/acceptanceScanner.ts");
  for (const code of ["RICE-001", "RICE-002", "RICE-003", "RICE-004"]) assert.ok(s.includes(`code: "${code}"`), `缺少 ${code}`);
  assert.ok(s.includes('module: "RICE"'), "有白米模組");
  assert.ok(s.includes("僅提示") || s.includes("不自動修正"), "只提示、不自動修正");
  // scanner 仍只讀（不得寫入）。
  for (const w of [".update(", ".create(", ".delete(", ".upsert("]) assert.equal(s.includes(w), false, `scanner 不得含寫入 ${w}`);
});

test("固定規則：白米不建第二套資料表（沿用 TempleEvent 設定與 RICE 報名項目）", () => {
  const svc = read("src/lib/whiteRiceService.ts");
  // 不得出現獨立白米收款／帳本／交易／報名表。
  assert.doesNotMatch(svc, /riceCollection|riceLedger|riceTransaction|ricePayment|riceReceipt/i);
  assert.ok(svc.includes('contentKind: "RICE"'), "沿用 RICE 報名項目");
});
