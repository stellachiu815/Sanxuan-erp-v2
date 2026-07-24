import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V14.4 Part 6B 整合結構測試（沙盒可執行；驗證接線與不變式）。
 * DB/HTTP/瀏覽器類（實際建牌位、confirm 物化、重送不重複、403）見檔尾 TODO：
 * 待 Mac/staging，未執行不計入通過。
 */
const ROOT = join(import.meta.dirname, "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf-8");

test("1. analyze 只寫草稿表，不建任何正式資料（RitualRecord/Entry/Item/應收）", () => {
  const svc = read("src/lib/purificationImport.ts");
  const analyze = svc.slice(svc.indexOf("export async function analyzePurificationImport"), svc.indexOf("// ── confirm"));
  // analyze 只 create 草稿表
  assert.equal(analyze.includes("purificationImportBatch.create"), true);
  assert.equal(analyze.includes("purificationImportRow.create"), true);
  // analyze 不得建立正式資料
  for (const banned of ["ritualRecord.create", "universalSalvationEntry.create", "ritualRegistrationItem.create", "createUniversalSalvationEntry", "registerRice"]) {
    assert.equal(analyze.includes(banned), false, `analyze 不得呼叫 ${banned}`);
  }
});

test("8/9/19. confirm 共用既有正式核心（createUniversalSalvationEntry / registerRice），不另寫建立邏輯", () => {
  const svc = read("src/lib/purificationImport.ts");
  const confirm = svc.slice(svc.indexOf("export async function confirmPurificationImportBatch"));
  assert.equal(confirm.includes("createUniversalSalvationEntry("), true);
  assert.equal(confirm.includes("registerRice("), true);
  // confirm 不得自己手寫 entry/item create
  assert.equal(confirm.includes("universalSalvationEntry.create"), false);
});

test("18/防重. confirm 原子鎖定 PENDING→PROCESSING＋confirmationKey 冪等（DB 唯一鍵）", () => {
  const svc = read("src/lib/purificationImport.ts");
  assert.equal(/updateMany\(\{\s*where: \{ id: batch\.id, status: "PENDING" \}/.test(svc), true, "原子鎖定");
  assert.equal(svc.includes('status: "PROCESSING"'), true);
  assert.equal(/confirmationKey === input\.confirmationKey && batch\.status === "CONFIRMED"/.test(svc), true, "同 key 已確認回既有結果");
  const schema = read("prisma/schema.prisma");
  // prisma format 會對齊欄位插入多個空白，故一律用 \s+ 容忍任意空白（不改 schema）。
  assert.equal(/confirmationKey\s+String\?\s+@unique/.test(schema), true, "confirmationKey 唯一鍵");
  assert.equal(/@@unique\(\[batchId,\s*rowNumber\]\)/.test(schema), true, "同 batch+rowNumber 唯一");
});

test("19/同列不重複. confirm 逐列：已 CONFIRMED 不重做；失敗記 FAILED 可重試", () => {
  const svc = read("src/lib/purificationImport.ts");
  assert.equal(svc.includes('row.confirmationStatus === "CONFIRMED"'), true, "已確認列略過");
  assert.equal(/confirmationStatus: "CONFIRMED", confirmedRecordId/.test(svc), true);
  assert.equal(/confirmationStatus: "FAILED", errorMessage/.test(svc), true);
});

test("10/11. 白米只用草稿斤數；價/配額由 registerRice 依今年重算（不採 Excel 單價）", () => {
  const svc = read("src/lib/purificationImport.ts");
  // extractRiceKgFromImport 只取斤數；confirm 用 edited.riceKg 呼叫 registerRice（內部讀今年 riceUnitPrice 鎖價）
  assert.equal(svc.includes("extractRiceKgFromImport"), true);
  assert.equal(/registerRice\(\{ ritualRecordId, memberId: [^,]+, kg: edited\.riceKg/.test(svc), true);
  // 白米價一律交給 registerRice（依今年 riceUnitPrice），import 不從 Excel 取白米單價/金額作為正式應收：
  // riceKg 呼叫附近不得出現自訂 lockedUnitPrice（僅贊普 materializeSponsors 才用 lockedUnitPrice）。
  const riceBlock = svc.slice(svc.indexOf("edited.riceKg && edited.riceKg > 0"), svc.indexOf("edited.riceKg && edited.riceKg > 0") + 260);
  assert.equal(riceBlock.includes("lockedUnitPrice"), false, "白米價由 registerRice 決定，import 不自訂");
});

test("20/21. 所有寫入路由 session operator＋權限（analyze/patch/confirm=create、READONLY 無 create→403）", () => {
  for (const f of [
    "src/app/api/universal-salvation/[year]/import/analyze/route.ts",
    "src/app/api/universal-salvation/[year]/import/[batchId]/rows/[rowId]/route.ts",
    "src/app/api/universal-salvation/[year]/import/[batchId]/confirm/route.ts",
  ]) {
    const src = read(f);
    // 三支寫入路由都需 create 權限（READONLY 無 create → 403），且身分一律取自 session。
    assert.equal(/assertUniversalSalvationPermissionForOperator\([\s\S]{0,90}"create"/.test(src), true, `${f} 需 create 權限`);
    assert.equal(src.includes("readOperatorUserId(request)"), true, `${f} operator 取自 session`);
  }
  // 會實際物化資料的路由（analyze/confirm）用 session operator（不接受前端傳入身分）。
  for (const f of [
    "src/app/api/universal-salvation/[year]/import/analyze/route.ts",
    "src/app/api/universal-salvation/[year]/import/[batchId]/confirm/route.ts",
  ]) {
    assert.equal(/check\.operator\.(id|name|role)/.test(read(f)), true, `${f} 用 session operator`);
  }
  // GET 讀取用 view
  const get = read("src/app/api/universal-salvation/[year]/import/[batchId]/route.ts");
  assert.equal(/assertUniversalSalvationPermissionForOperator\([\s\S]{0,90}"view"/.test(get), true);
});

test("UI 入口實際可到達：活動頁有 Excel 匯入連結；import 頁 render 匯入畫面", () => {
  const act = read("src/app/activities/[id]/page.tsx");
  assert.equal(/universal-salvation\/\$\{eventPricing\.year\}\/import/.test(act), true, "活動頁有匯入入口連結");
  const page = read("src/app/universal-salvation/[year]/import/page.tsx");
  assert.equal(page.includes("<PurificationImportScreen"), true, "import 頁實際 render 匯入畫面");
});

test("UI：上傳只建草稿、confirm 帶 confirmationKey 防連點、READONLY 無寫入", () => {
  const ui = read("src/components/universal-salvation/PurificationImportScreen.tsx");
  assert.equal(ui.includes("/import/analyze"), true);
  assert.equal(ui.includes("confirmationKey"), true);
  assert.equal(/disabled=\{confirming/.test(ui), true, "confirm 送出鎖定");
  assert.equal(ui.includes("canWrite"), true, "READONLY 無寫入操作");
});

test("缺口1. confirm 新家戶/新信眾共用既有 service（createHousehold/createMemberForHousehold），不直接 INSERT", () => {
  const svc = read("src/lib/purificationImport.ts");
  assert.equal(svc.includes("createHousehold("), true, "共用建立家戶 service");
  assert.equal(svc.includes("createMemberForHousehold("), true, "共用建立信眾 service");
  // 只有明確確認才建新
  assert.equal(svc.includes("row.createNewHouseholdConfirmed"), true);
  assert.equal(svc.includes("row.createNewDevoteeConfirmed"), true);
  // 建完回寫正式 id 後才用於後續核心
  assert.equal(/householdId = hh\.household\.id/.test(svc), true);
  assert.equal(/memberId = mem\.member\.id/.test(svc), true);
  // 不直接對 household/member 下 create（走 service）
  assert.equal(svc.includes("prisma.household.create"), false);
  assert.equal(svc.includes("prisma.member.create"), false);
});

test("缺口2. confirm 額外寶袋共用 createAdditionalPrintItem（isExtra=true），不覆蓋預設 POCKET、非補印", () => {
  const svc = read("src/lib/purificationImport.ts");
  assert.equal(/extraPocketCount > 0[\s\S]{0,200}createAdditionalPrintItem\(/.test(svc), true);
  assert.equal(/itemType: "POCKET", usesSourceName: true, quantity: edited\.extraPocketCount, isExtra: true/.test(svc), true);
  // 不動 printCount / 不呼叫列印確認
  assert.equal(svc.includes("confirmPrintObjects"), false);
});

test("缺口3. confirm 贊普/隨喜贊普共用既有 RitualRegistrationItem（US_SPONSOR/US_SPONSOR_DONATION），不另建 sponsor service", () => {
  const svc = read("src/lib/purificationImport.ts");
  assert.equal(svc.includes("materializeSponsors("), true);
  assert.equal(svc.includes('key: { in: ["US_SPONSOR", "US_SPONSOR_DONATION"] }'), true);
  assert.equal(/feeChoice: "FIXED"/.test(svc), true, "贊普 FIXED");
  assert.equal(/feeChoice: "CUSTOM"/.test(svc), true, "隨喜贊普 CUSTOM");
  // 走既有 RitualRegistrationItem（status CONFIRMED → receivableAdapters 認列），不另建 sponsor 表/service
  assert.equal(svc.includes("ritualRegistrationItem.create"), true);
});

test("三來源共用正式核心：手動/沿用去年/Excel confirm 都走 createUniversalSalvationEntry + ensureTabletPrintObjects + registerRice", () => {
  const ritual = read("src/lib/ritual.ts"); // 手動 createUniversalSalvationEntry + 沿用去年 copy
  const imp = read("src/lib/purificationImport.ts"); // Excel confirm
  // 手動：createUniversalSalvationEntry 內建 ensureLinkedTabletItem + ensureTabletPrintObjects
  assert.equal(ritual.includes("ensureTabletPrintObjects(") && ritual.includes("ensureLinkedTabletItem("), true);
  // Excel confirm 共用 createUniversalSalvationEntry + registerRice（不自寫 entry/rice）
  assert.equal(imp.includes("createUniversalSalvationEntry(") && imp.includes("registerRice("), true);
  assert.equal(imp.includes("universalSalvationEntry.create"), false, "Excel 不自寫 entry create");
});

test("tx-aware. Excel confirm 會呼叫的既有 service 都支援 optional db/tx client", () => {
  const checks: [string, RegExp][] = [
    ["src/lib/prisma.ts", /export type DbClient = PrismaClient \| Prisma\.TransactionClient/],
    ["src/lib/whiteRiceService.ts", /export async function registerRice\([\s\S]{0,220}db\?: DbClient/],
    ["src/lib/householdManagement.ts", /export async function createHousehold\([\s\S]{0,120}db\?: DbClient/],
    ["src/lib/memberCreate.ts", /export async function createMemberForHousehold\([\s\S]{0,160}db\?: DbClient/],
    ["src/lib/ritual.ts", /export async function createUniversalSalvationEntry\([\s\S]{0,180}db\?: DbClient/],
    ["src/lib/ritual.ts", /export async function createBlankUniversalSalvationRecord\([\s\S]{0,80}db\?: DbClient/],
    ["src/lib/additionalPrintItems.ts", /export async function createAdditionalPrintItem\([\s\S]{0,200}db\?: DbClient/],
  ];
  for (const [f, re] of checks) assert.equal(re.test(read(f)), true, `${f} 應支援 optional db/tx`);
});

test("tx-aware. 舊呼叫不傳 db 時維持原本 transaction 行為（db ? run(db) : prisma.$transaction(run)）", () => {
  const rice = read("src/lib/whiteRiceService.ts");
  assert.equal(/return db \? run\(db\) : prisma\.\$transaction\(run\)/.test(rice), true);
  const ritual = read("src/lib/ritual.ts");
  assert.equal(/if \(db\) await run\(db\);\s*else await prisma\.\$transaction\(run\)/.test(ritual), true);
  assert.equal(/db \? await runBlank\(db\) : await prisma\.\$transaction\(runBlank\)/.test(ritual), true);
  const api = read("src/lib/additionalPrintItems.ts");
  assert.equal(/db \? await runCreate\(db\) : await prisma\.\$transaction\(runCreate\)/.test(api), true);
});

test("tx-aware. Excel confirm 單列在同一 prisma.\$transaction 內，把 tx 傳給每個建立 service", () => {
  const svc = read("src/lib/purificationImport.ts");
  const loop = svc.slice(svc.indexOf("const recordId = await prisma.$transaction"), svc.indexOf("results.push({ rowNumber: row.rowNumber, ok: true, recordId });"));
  // 家戶/信眾/record/牌位/白米/寶袋/贊普/row 更新都在同一 tx（傳 tx）——以子字串驗證 tx 已傳入。
  assert.equal(loop.includes("input.actor.name, tx"), true, "createHousehold/entry/寶袋 傳 tx");
  assert.equal(loop.includes('"Excel 匯入：新增信眾", tx'), true, "createMemberForHousehold 傳 tx");
  assert.equal(loop.includes("createBlankUniversalSalvationRecord(householdId, batch.year, tx)"), true, "record 傳 tx");
  assert.equal(loop.includes("input.actor, tx)"), true, "白米 registerRice 傳 tx");
  assert.equal(loop.includes("materializeSponsors(ritualRecordId, memberId, batch.templeEventId, edited, input.actor.name, tx)"), true, "贊普 傳 tx");
  assert.equal(loop.includes('tx.purificationImportRow.update({ where: { id: row.id }, data: { confirmationStatus: "CONFIRMED"'), true, "row 更新在 tx 內");
});

test("tx-aware. 失敗整列 rollback：CONFIRMED 更新在 tx 內、FAILED 更新在 tx 外（不留半套）", () => {
  const svc = read("src/lib/purificationImport.ts");
  // CONFIRMED 在 tx 內（成功才 return，失敗連同 rollback）
  assert.equal(/tx\.purificationImportRow\.update\([\s\S]{0,160}"CONFIRMED"/.test(svc), true);
  // FAILED 在 catch（tx 外）：transaction 已 rollback 無殘留，才標 FAILED 供重試
  assert.equal(/catch \(e\)[\s\S]{0,260}prisma\.purificationImportRow\.update\([\s\S]{0,120}"FAILED"/.test(svc), true);
  // 交易內防重：已 CONFIRMED 不重做
  assert.equal(/fresh\?\.confirmationStatus === "CONFIRMED"/.test(svc), true);
});

test("migration 純附加建立草稿表＋唯一鍵，不動既有正式資料", () => {
  const mig = read("prisma/migrations/20260806000000_v14_4_purification_import/migration.sql");
  assert.equal(mig.includes("CREATE TABLE IF NOT EXISTS \"purification_import_batches\""), true);
  assert.equal(mig.includes("CREATE TABLE IF NOT EXISTS \"purification_import_rows\""), true);
  assert.equal(mig.includes("purification_import_rows_batchId_rowNumber_key"), true);
  // 不得 DROP / ALTER 既有正式表
  assert.equal(/DROP TABLE|ALTER TABLE "ritual_records"|ALTER TABLE "universal_salvation/.test(mig), false);
});
