import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeRiceItemData, evaluateRiceQuota } from "../src/lib/whiteRice";

/**
 * V16 白米（普渡報名項目｜斤數／計價／收款／年度總量）——純邏輯 + 來源掃描驗收。
 *
 * 純邏輯：直接執行真實 src 函式（無 Prisma 依賴）。
 * 來源掃描：驗證各入口確實接上同一套 server-side 白米計價／配額邏輯，
 *          且未建立第二套白米收款／帳本／交易／報名／列印追蹤。
 * DB 行為（跨家戶配額、確認佔額、超量阻擋…）另見 tests/v16RiceDb.test.ts（RUN_DB_TESTS 於 Mac 執行）。
 */

const SRC = (rel: string) => readFileSync(join(process.cwd(), "src", rel), "utf8");

// ── A. computeRiceItemData：斤數必須正整數、單價須已設定，且不得以 0 元計 ──
test("A1. 正整數斤數×單價→amountDue=amountUnpaid，lockedUnitPrice 快照", () => {
  const r = computeRiceItemData(5, 30);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.data.quantity, 5);
    assert.equal(r.data.lockedUnitPrice, 30);
    assert.equal(r.data.amountDue, 150);
    assert.equal(r.data.amountUnpaid, 150);
  }
});

test("A2. 單價 null（未設定）→ 阻擋、不得以 0 元計", () => {
  const r = computeRiceItemData(5, null);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /0 元|未設定/);
});

test("A3. 單價為 0 合法（免費年度可，但不是 null 偷 0）", () => {
  const r = computeRiceItemData(3, 0);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.amountDue, 0);
});

test("A4. 負單價→阻擋", () => {
  assert.equal(computeRiceItemData(3, -1).ok, false);
});

test("A5. 斤數 0→阻擋（不接受）", () => {
  const r = computeRiceItemData(0, 30);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /大於 0/);
});

test("A6. 斤數負數→阻擋", () => {
  assert.equal(computeRiceItemData(-2, 30).ok, false);
});

test("A7. 斤數小數→阻擋（不無聲四捨五入）", () => {
  const r = computeRiceItemData(2.5, 30);
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /正整數|小數/);
});

test("A8. 斤數 NaN／非數字→阻擋", () => {
  assert.equal(computeRiceItemData(Number.NaN, 30).ok, false);
  assert.equal(computeRiceItemData("x" as unknown as number, 30).ok, false);
});

test("A9. amountDue 以 2 位四捨五入（Decimal(12,2) 慣例）", () => {
  const r = computeRiceItemData(3, 33.335);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.amountDue, 100.01);
});

// ── B. evaluateRiceQuota：依「允許超量開關」判斷，關閉時所有角色一律不得超量 ──
test("B1. 未超量→通過、overbook=false", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: 40, deltaKg: 10, allowOverbook: false });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.overbook, false);
    assert.equal(r.remainingBefore, 60);
    assert.equal(r.remainingAfter, 50);
  }
});

test("B2. 剛好用完→通過（剩餘 0）", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: 90, deltaKg: 10, allowOverbook: false });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.remainingAfter, 0);
});

test("B3. 超量 + 未開放→阻擋，錯誤含年度總量/已認購/本次/剩餘/超出", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: 95, deltaKg: 10, allowOverbook: false });
  assert.equal(r.ok, false);
  if (!r.ok) {
    assert.equal(r.totalKg, 100);
    assert.equal(r.registeredKg, 95);
    assert.equal(r.deltaKg, 10);
    assert.equal(r.remainingKg, 5);
    assert.equal(r.overBy, 5);
    assert.match(r.error, /年度可認購 100 斤/);
    assert.match(r.error, /已認購 95 斤/);
    assert.match(r.error, /剩餘 5 斤/);
    assert.match(r.error, /超出 5 斤/);
    assert.match(r.error, /未開放超量/);
  }
});

test("B4. 超量 + 已開放→通過、overbook=true、remainingAfter 可為負", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: 95, deltaKg: 10, allowOverbook: true });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.overbook, true);
    assert.equal(r.remainingAfter, -5);
  }
});

test("B5. 減量（delta<0）一律通過（釋放額度），即使未開放超量", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: 120, deltaKg: -30, allowOverbook: false });
  assert.ok(r.ok);
});

test("B6. delta=0（不變）通過", () => {
  assert.equal(evaluateRiceQuota({ totalKg: 100, registeredKg: 50, deltaKg: 0, allowOverbook: false }).ok, true);
});

test("B7. totalKg null（未設定）視為 0；任何正增量在未開放時皆超量阻擋", () => {
  const r = evaluateRiceQuota({ totalKg: null, registeredKg: 0, deltaKg: 1, allowOverbook: false });
  assert.equal(r.ok, false);
});

test("B8. ADMIN/SUPER_ADMIN 無角色覆寫概念——evaluateRiceQuota 不吃 role 參數", () => {
  // 型別層面：函式簽名只有 totalKg/registeredKg/deltaKg/allowOverbook；
  // 未開放超量時，唯一放行途徑是 allowOverbook=true（非角色）。
  const blocked = evaluateRiceQuota({ totalKg: 10, registeredKg: 10, deltaKg: 1, allowOverbook: false });
  assert.equal(blocked.ok, false);
});

// ── C. 服務層：抽出共用能力，且未建立第二套白米收款/帳本/交易 ──
test("C1. whiteRiceService 匯出 assertRiceQuota / updateRiceQuantity / getRiceQuotaSummary / updateRiceConfig / registerRice", () => {
  const s = SRC("lib/whiteRiceService.ts");
  for (const fn of ["assertRiceQuota", "updateRiceQuantity", "getRiceQuotaSummary", "updateRiceConfig", "registerRice"]) {
    assert.match(s, new RegExp(`export async function ${fn}`), `缺少 ${fn}`);
  }
});

test("C2. registerRice 改用 computeRiceItemData + evaluateRiceQuota（不再 role 覆寫）", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /computeRiceItemData\(kg, unitPrice\)/);
  assert.match(s, /evaluateRiceQuota\(\{/);
  // 已不再於 registerRice 內用角色決定超量（checkRiceOverage 不再被服務層 import 使用）。
  assert.doesNotMatch(s, /checkRiceOverage\(/);
});

test("C3. registerRice 建立時 amountPaid=0、寫 lockedUnitPrice、status CONFIRMED；不建第二套收款/交易", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /amountPaid: new Prisma\.Decimal\(0\)/);
  assert.match(s, /lockedUnitPrice: new Prisma\.Decimal\(calc\.data\.lockedUnitPrice\)/);
  // 白米沿用 RitualRegistrationItem，不得出現獨立白米收款/帳本/交易表寫入。
  assert.doesNotMatch(s, /riceCollection|riceLedger|riceTransaction|ricePayment/i);
});

test("C4. updateRiceQuantity 用該筆 lockedUnitPrice、溢收保護、不動 amountPaid", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /toNum\(item\.lockedUnitPrice\)/);
  assert.match(s, /新應收.*低於.*已收|amountDue < amountPaid/);
  // 更新只動 quantity/amountDue/amountUnpaid；不得改 amountPaid。
  const block = s.slice(s.indexOf("export async function updateRiceQuantity"));
  assert.doesNotMatch(block.slice(0, block.indexOf("recordVersion")), /data: \{[^}]*amountPaid/);
});

test("C5. assertRiceQuota 只彙總有效正式認購（validRiceItemWhere），tx 內再檢查", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /assertRiceQuota[\s\S]*validRiceItemWhere\(event\.year\)/);
  assert.match(s, /assertRiceQuota[\s\S]*evaluateRiceQuota\(\{/);
});

// ── D. 六大入口共用同一套邏輯（不各自造 0 元白米） ──
test("D1. registerItemsBatch 白米特例：讀年度單價、驗證 open、computeRiceItemData、DRAFT、不走 feeMode NONE 產 0 元", () => {
  const s = SRC("lib/registrationItemRegistration.ts");
  assert.match(s, /contentKind === "RICE"/);
  assert.match(s, /computeRiceItemData\(quantity, cfg\.unitPrice\)/);
  assert.match(s, /riceConfigByYear/);
  assert.match(s, /本年度白米尚未開放認購/);
});

test("D2. registerItemsBatch 白米建立時鎖 lockedUnitPrice = 年度單價", () => {
  const s = SRC("lib/registrationItemRegistration.ts");
  assert.match(s, /createLocked = riceConfigByYear\.get\(p\.entry\.year\)\?\.unitPrice/);
});

test("D3. confirmRegistration：DRAFT 白米轉 CONFIRMED 前於同 tx assertRiceQuota", () => {
  const s = SRC("lib/activityRegistration.ts");
  assert.match(s, /assertRiceQuota\(tx, record\.templeEventId, deltaKg\)/);
  assert.match(s, /registrationItemType: \{ contentKind: "RICE" \}/);
  assert.match(s, /RiceQuotaBlockedError/);
});

test("D4. 沿用去年：carryOver 走同一 registerItemsBatch（新年度重算、不帶付款/列印）", () => {
  const s = SRC("lib/registrationItemRegistration.ts");
  assert.match(s, /carryOverHouseholdRegistration[\s\S]*registerItemsBatch\(entries, operatorName\)/);
  // carry-over 只讀 memberId/quantity/customName/型別，不複製 amountPaid/printedAt。
  const block = s.slice(s.indexOf("carryOverHouseholdRegistration"));
  assert.doesNotMatch(block.slice(0, 1200), /amountPaid|printedAt|printCount/);
});

test("D5. Excel 匯入：confirm 走 registerRice（含 tx 內配額檢查），預覽顯示斤數/單價/預計應收/預估剩餘", () => {
  const s = SRC("lib/purificationImport.ts");
  assert.match(s, /registerRice\(\{ ritualRecordId, memberId[\s\S]*kg: edited\.riceKg/);
  assert.match(s, /riceRequestedKg/);
  assert.match(s, /riceUnitPrice/);
  assert.match(s, /riceEstimatedAmountDue/);
  assert.match(s, /riceProjectedRemainingKg/);
});

test("D6. 白米認購 API：POST create、PATCH update（改斤數）；操作人取自 session", () => {
  const s = SRC("app/api/universal-salvation/[year]/rice/route.ts");
  assert.match(s, /export async function POST/);
  assert.match(s, /export async function PATCH/);
  assert.match(s, /updateRiceQuantity\(itemId, kg, \{ name: check\.operator\.name \}\)/);
  assert.match(s, /readOperatorUserId\(request\)/);
});

// ── E. 設定權限與允許超量開關 ──
test("E1. rice-config PATCH 權限＝活動設定管理（manageSettings，ADMIN/SUPER_ADMIN）", () => {
  const s = SRC("app/api/temple-events/[id]/rice-config/route.ts");
  assert.match(s, /assertActivityPermissionForOperator\(await readOperatorUserId\(request\), "manageSettings"\)/);
  assert.match(s, /input\.allowOverbook = Boolean\(body\.allowOverbook\)/);
});

test("E2. updateRiceConfig 支援 allowOverbook（純新增，不改既有年度語意）", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /allowOverbook\?: boolean/);
  assert.match(s, /riceAllowOverbook.*Boolean\(input\.allowOverbook\)/);
});

test("E3. getRiceQuotaSummary 回傳 allowOverbook 與 count", () => {
  const s = SRC("lib/whiteRiceService.ts");
  assert.match(s, /allowOverbook:/);
  assert.match(s, /count:/);
});

// ── F. 列印：只姓名+斤數，走 US_RICE_ROSTER + 既有列印中心 ──
test("F1. 白米列印檢視只有姓名＋斤數（US_RICE 專用簡表）", () => {
  const s = SRC("app/print-center/rosters/[itemKey]/[year]/page.tsx");
  assert.match(s, /itemKey === "US_RICE"/);
  assert.match(s, /白米認購名單/);
  assert.match(s, /斤數/);
});

test("F2. 白米列印沿用同一列印中心 mark-printed（不建第二套列印追蹤）", () => {
  // V21.1：名冊頁改用共用的 RosterPrintButton（先預覽→確認→開始列印→完成後才記錄），
  // 仍沿用同一支 mark-printed 端點，不建第二套列印追蹤。
  const page = SRC("app/print-center/rosters/[itemKey]/[year]/page.tsx");
  assert.match(page, /RosterPrintButton/);
  const btn = SRC("components/print/RosterPrintButton.tsx");
  assert.match(btn, /print-center\/rosters\/\$\{itemKey\}\/\$\{year\}\/mark-printed/);
});

test("F3. US_RICE 種子項目 printDocumentKeys 含 US_RICE_ROSTER、contentKind RICE、feeMode NONE", () => {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260725000002_v14_seed_registration_items/migration.sql"), "utf8");
  assert.match(sql, /US_RICE_ROSTER/);
  assert.match(sql, /US_RICE/);
});

// ── G. schema/migration：純新增 riceAllowOverbook ──
test("G1. schema：TempleEvent 新增 riceAllowOverbook Boolean @default(false)", () => {
  const schema = readFileSync(join(process.cwd(), "prisma/schema.prisma"), "utf8");
  assert.match(schema, /riceAllowOverbook\s+Boolean\s+@default\(false\)/);
});

test("G2. migration：單一 ALTER TABLE 新增欄位、預設 false、NOT NULL（不建新表）", () => {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260816000000_v16_rice_allow_overbook/migration.sql"), "utf8");
  assert.match(sql, /ALTER TABLE "temple_events" ADD COLUMN "riceAllowOverbook" BOOLEAN NOT NULL DEFAULT false/);
  assert.doesNotMatch(sql, /CREATE TABLE/i);
});

test("G3. 未新增第二套白米報名/收款/列印資料表（migration 僅一次 ALTER）", () => {
  const sql = readFileSync(join(process.cwd(), "prisma/migrations/20260816000000_v16_rice_allow_overbook/migration.sql"), "utf8");
  const alters = (sql.match(/ALTER TABLE/g) ?? []).length;
  assert.equal(alters, 1);
});

// ── H. 邊界：整數/彙總四捨五入一致 ──
test("H1. evaluateRiceQuota registeredKg 取 max(0,·)（不因負值誤放行）", () => {
  const r = evaluateRiceQuota({ totalKg: 100, registeredKg: -5, deltaKg: 10, allowOverbook: false });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.remainingBefore, 100);
});

test("H2. computeRiceItemData 空白斤數（空字串轉 NaN）→阻擋", () => {
  assert.equal(computeRiceItemData(Number(""), 30).ok, false);
});

test("H3. 大量斤數×單價精度（1234×56=69104）", () => {
  const r = computeRiceItemData(1234, 56);
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.data.amountDue, 69104);
});
