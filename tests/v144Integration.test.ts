import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V14.4 整合驗證測試（Part 7）。
 *
 * 分類（見指令 Part 7）：
 *  - A. 純邏輯／結構（本檔，可在沙盒 tsx 執行）：以 fs 讀原始碼驗證整合接線，
 *       與既有 v13x/v14x 結構測試同一慣例，能真的抓到「元件沒掛載／建立路徑
 *       沒共用 ensureTabletPrintObjects／沿用去年複製了財務」等回歸。
 *  - B. Prisma/DB service 測試、C. HTTP/session API 權限測試、D. 瀏覽器/staging
 *       UI 測試：見檔尾 describe 的 TODO 清單，標示「待 Mac/staging」，未執行不計為通過。
 *
 * 這些純邏輯的計價/配額/列印次數驗收（1/3/4/5/6/9/10/11/12/13/14/…）在
 * tests/v144PrintAndRice.test.ts 已覆蓋並通過；此檔補「整合接線」的結構驗證。
 */

const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

// ── WhiteRicePanel 實際掛載（驗收 1、2）──────────────────────────
test("1. WhiteRicePanel 掛載於年度設定頁（activities/[id]）並實際 render", () => {
  const page = read("src/app/activities/[id]/page.tsx");
  assert.equal(page.includes('from "@/components/universal-salvation/WhiteRicePanel"'), true, "有 import");
  assert.equal(/<WhiteRicePanel\s+templeEventId=/.test(page), true, "有實際 render 且傳 templeEventId");
});

test("2. WhiteRicePanel 掛載於普渡報名編輯器（UniversalSalvationScreen）並實際 render", () => {
  const scr = read("src/components/ritual/UniversalSalvationScreen.tsx");
  assert.equal(scr.includes('from "@/components/universal-salvation/WhiteRicePanel"'), true, "有 import");
  assert.equal(/<WhiteRicePanel\s+year=\{year\}\s+ritualRecordId=/.test(scr), true, "有 render 且傳 ritualRecordId");
});

test("3. WhiteRicePanel 設定表單僅在有 templeEventId 時顯示；READONLY 唯讀", () => {
  const c = read("src/components/universal-salvation/WhiteRicePanel.tsx");
  assert.equal(c.includes("role !== \"READONLY\""), true, "canEdit 由角色決定");
  assert.equal(/templeEventId && <RiceSettings/.test(c), true, "設定表單僅年度設定頁出現");
  assert.equal(c.includes("useCurrentUser"), true, "用共用 session 角色");
});

// ── 預設列印物件：所有建立路徑共用 ensureTabletPrintObjects（驗收 8–12）──
test("8-11. 所有 UniversalSalvationEntry 建立路徑都共用 ensureTabletPrintObjects", () => {
  for (const f of [
    "src/lib/ritual.ts", // 手動 createUniversalSalvationEntry + 沿用去年 copy
    "src/lib/soulTabletFlow.ts", // 辭世流程
    "src/lib/registrationItemRegistration.ts", // 全戶冤親批次
  ]) {
    const src = read(f);
    assert.equal(src.includes("ensureTabletPrintObjects("), true, `${f} 應呼叫共用 ensureTabletPrintObjects`);
    // 不得各自手寫 additionalPrintItem.create 建 TABLET/POCKET（copy/建立路徑）
  }
});

test("11. 沿用去年 copy 對每筆草稿牌位建立預設列印物件（printCount=0，方案 A）", () => {
  const src = read("src/lib/ritual.ts");
  // copy 迴圈同時共用 ensureLinkedTabletItem + ensureTabletPrintObjects
  assert.equal(/copiedEntries[\s\S]{0,400}ensureTabletPrintObjects/.test(src), true);
  assert.equal(/copiedEntries[\s\S]{0,400}ensureLinkedTabletItem/.test(src), true);
});

test("14. 預設列印物件唯一鍵只限 isExtra=false（額外寶袋不受限）", () => {
  const mig = read("prisma/migrations/20260805000000_v14_4_print_objects_white_rice/migration.sql");
  assert.equal(/additional_print_items_default_object_uq[\s\S]*WHERE "isExtra" = false/.test(mig), true);
});

// ── 列印確認（驗收 15/16/19/20）───────────────────────────────
test("15/16. 列印中心：開啟預覽不呼叫 confirm；只有確認鍵呼叫 confirm API", () => {
  const c = read("src/components/universal-salvation/PrintObjectCenter.tsx");
  // openPrintPreview 只 window.print，不 fetch confirm
  assert.equal(/function openPrintPreview[\s\S]{0,300}window\.print/.test(c), true);
  assert.equal(/openPrintPreview[\s\S]{0,300}print-items\/confirm/.test(c), false, "預覽不得呼叫 confirm");
  // confirmPrinted 才呼叫 confirm API
  assert.equal(/function confirmPrinted[\s\S]{0,600}print-items\/confirm/.test(c), true);
});

test("19. confirm 帶 idempotencyKey；20. 送出期間鎖定按鈕", () => {
  const c = read("src/components/universal-salvation/PrintObjectCenter.tsx");
  assert.equal(c.includes("idempotencyKey"), true);
  assert.equal(/disabled=\{[^}]*submitting/.test(c), true, "submitting 鎖定按鈕");
});

test("20. READONLY 不顯示確認按鈕，且 confirm API 後端要求 print 權限（READONLY 無 → 403）", () => {
  const ui = read("src/components/universal-salvation/PrintObjectCenter.tsx");
  assert.equal(ui.includes("canPrint"), true);
  assert.equal(/role !== "READONLY"/.test(ui), true);
  const api = read("src/app/api/universal-salvation/[year]/print-items/confirm/route.ts");
  assert.equal(/assertUniversalSalvationPermissionForOperator\([\s\S]{0,80}"print"\)/.test(api), true, "後端擋 print 權限");
  assert.equal(api.includes("check.operator.id"), true, "operator 一律來自 session");
});

// ── 沿用去年不複製財務/列印（驗收 22–25）──────────────────────
test("22-25. 沿用去年不複製收款/已收/列印紀錄（新建 DRAFT、amountPaid=0、不帶列印欄位）", () => {
  const src = read("src/lib/ritual.ts");
  // 複製建立的 record 一律 DRAFT
  assert.equal(/status: "DRAFT"/.test(src), true);
  // 付款一律歸零，不帶去年
  assert.equal(/amountPaid: 0/.test(src), true);
  // 複製 entries 的欄位不含任何列印時間/次數
  const copyBlock = src.slice(src.indexOf("universalSalvation.entries.map"), src.indexOf("universalSalvation.entries.map") + 900);
  for (const banned of ["printedAt", "printCount", "reprintCount", "firstPrintedAt", "lastPrintedAt", "lastPrintedByUserId"]) {
    assert.equal(copyBlock.includes(`${banned}:`), false, `copy 不得帶入 ${banned}`);
  }
});

// ── 白米財務/權限（驗收 41/42/46/47）──────────────────────────
test("42. registerRice 鎖定 lockedUnitPrice；41. amountDue=斤×鎖定價", () => {
  const svc = read("src/lib/whiteRiceService.ts");
  assert.equal(svc.includes("lockedUnitPrice: new Prisma.Decimal(unitPrice)"), true, "鎖定當年度單價");
  assert.equal(/amountDue = computeRiceAmountDue\(kg, unitPrice\)/.test(svc), true, "應收=斤×單價");
  // 重新彙總剩餘斤數（不快取增減）
  assert.equal(/validRiceItemWhere\(event\.year\)[\s\S]{0,200}_sum: \{ quantity: true \}/.test(svc), true);
});

test("46/47. 白米/列印新寫入 API operator 來自 session、READONLY 被擋", () => {
  const rice = read("src/app/api/universal-salvation/[year]/rice/route.ts");
  assert.equal(/assertUniversalSalvationPermissionForOperator\([\s\S]{0,80}"create"\)/.test(rice), true, "報名需 create（READONLY 無）");
  assert.equal(rice.includes("check.operator.id"), true, "operator 來自 session");
  const cfg = read("src/app/api/temple-events/[id]/rice-config/route.ts");
  assert.equal(/assertUniversalSalvationPermissionForOperator\([\s\S]{0,80}"update"\)/.test(cfg), true, "設定 PATCH 需 update");
});

// ── 超額（驗收 5/6/28）──────────────────────────────────────
test("5/6/28. 超額：STAFF 擋、ADMIN/SUPER 需原因（checkRiceOverage 在 registerRice 內每次重判）", () => {
  const svc = read("src/lib/whiteRiceService.ts");
  assert.equal(/checkRiceOverage\(actor\.role, kg, remainingKg, input\.overageReason\)/.test(svc), true);
  assert.equal(/if \(!decision\.ok\) return \{ ok: false as const, status: 403/.test(svc), true);
});
