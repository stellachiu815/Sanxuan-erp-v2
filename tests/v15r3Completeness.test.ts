import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkAnnualLantern,
  checkDragonPhoenixLantern,
  checkUniversalSalvationItem,
  combineCompleteness,
  formatMissing,
  resolveLunarAvailable,
  resolveTabletAddress,
} from "../src/lib/dataCompleteness";

test("地址來源安全：只用本筆自己的來源，不跨牌位/不跨家戶", () => {
  // 甲祖先：本次輸入地址 A → 用 A。
  assert.equal(resolveTabletAddress({ inputAddress: "A路", householdAddress: "家戶地址" }), "A路");
  // 乙祖先：本次輸入地址 B → 用 B（不會拿到甲的 A）。
  assert.equal(resolveTabletAddress({ inputAddress: "B路", householdAddress: "家戶地址" }), "B路");
  // 未輸入 → 退回本家戶地址（非其他牌位）。
  assert.equal(resolveTabletAddress({ inputAddress: "", householdAddress: "家戶地址" }), "家戶地址");
  // 更新既有牌位：用該筆自己的 sameEntryAddress。
  assert.equal(resolveTabletAddress({ inputAddress: "", sameEntryAddress: "本牌位地址", householdAddress: "家戶地址" }), "本牌位地址");
  // 全無 → null（呼叫端顯示「缺牌位地址」）。
  assert.equal(resolveTabletAddress({}), null);
  // 明確：不提供任何「其他牌位地址」參數的入口——函式簽章不含 sibling，結構上不可能污染。
});

/** V15R3 資料完整度驗證純函式測試（沙盒可執行）。 */

test("年度燈：齊全（農曆可取得）→ complete", () => {
  const r = checkAnnualLantern({ name: "王大明", lunarBirthResolved: true, address: "台北市", zodiac: "龍", gender: "男" });
  assert.equal(r.complete, true);
  assert.deepEqual(r.missing, []);
});

test("年度燈：缺生肖、農曆無法取得 → 列出缺項", () => {
  const r = checkAnnualLantern({ name: "王大明", address: "台北市", gender: "男" });
  assert.equal(r.complete, false);
  const fields = r.missing.map((m) => m.field).sort();
  assert.deepEqual(fields, ["lunarBirth", "zodiac"]);
  assert.equal(formatMissing(r).includes("⚠ 缺生肖"), true);
  assert.equal(formatMissing(r).includes("⚠ 缺農曆生日"), true);
});

test("規則六：只有國曆但換算失敗 → 仍判定缺農曆生日", () => {
  // 換算成功 → 可取得。
  assert.equal(resolveLunarAvailable({ hasSolarBirth: true, solarToLunarOk: true }), true);
  // 換算失敗 → 不可取得。
  assert.equal(resolveLunarAvailable({ hasSolarBirth: true, solarToLunarOk: false }), false);
  // 直接有農曆 → 可取得。
  assert.equal(resolveLunarAvailable({ hasLunarBirth: true }), true);
  assert.equal(resolveLunarAvailable({}), false);
  // 套進年度燈：只有國曆換算失敗 → 缺農曆生日。
  const r = checkAnnualLantern({
    name: "王大明",
    lunarBirthResolved: resolveLunarAvailable({ hasSolarBirth: true, solarToLunarOk: false }),
    address: "台北市",
    zodiac: "馬",
    gender: "女",
  });
  assert.equal(r.complete, false);
  assert.deepEqual(r.missing.map((m) => m.field), ["lunarBirth"]);
});

test("龍鳳燈：缺農曆生日與燈種 → 列出", () => {
  const r = checkDragonPhoenixLantern({ name: "李小華", address: "新北市", zodiac: "虎" });
  assert.equal(r.complete, false);
  const fields = r.missing.map((m) => m.field).sort();
  assert.deepEqual(fields, ["lanternKind", "lunarBirth"]);
});

test("普渡・歷代祖先：需陽上人＋牌位地址", () => {
  assert.equal(checkUniversalSalvationItem("US_ANCESTOR", { yangshangNames: ["王大明"], tabletAddress: "台北市A路" }).complete, true);
  const r = checkUniversalSalvationItem("US_ANCESTOR", { yangshangNames: [] });
  assert.deepEqual(r.missing.map((m) => m.field).sort(), ["tabletAddress", "yangshang"]);
});

test("普渡・乙位正魂：同祖先規則", () => {
  const r = checkUniversalSalvationItem("US_ZHENGHUN", { yangshangNames: ["李小華"] });
  assert.deepEqual(r.missing.map((m) => m.field), ["tabletAddress"]);
});

test("普渡・冤親：需陽上人（地址非必填不擋）", () => {
  assert.equal(checkUniversalSalvationItem("US_YUANQIN", { yangshangNames: ["張三"] }).complete, true);
  assert.equal(checkUniversalSalvationItem("US_YUANQIN", {}).complete, false);
});

test("普渡・白米：需認購人＋重量", () => {
  assert.equal(checkUniversalSalvationItem("US_RICE", { purchaserName: "王大明", weightKg: 20 }).complete, true);
  const r = checkUniversalSalvationItem("US_RICE", { weightKg: 0 });
  assert.deepEqual(r.missing.map((m) => m.field).sort(), ["purchaser", "weight"]);
});

test("普渡・贊普／隨喜贊普：需姓名＋金額", () => {
  assert.equal(checkUniversalSalvationItem("US_SPONSOR", { sponsorName: "王大明", amount: 1500 }).complete, true);
  assert.equal(checkUniversalSalvationItem("US_SPONSOR_DONATION", { sponsorName: "啟華重工", amount: 5000 }).complete, true);
  const r = checkUniversalSalvationItem("US_SPONSOR", { amount: 0 });
  assert.deepEqual(r.missing.map((m) => m.field).sort(), ["amount", "name"]);
});

test("combineCompleteness：多項彙總並去重", () => {
  const a = checkUniversalSalvationItem("US_ANCESTOR", { yangshangNames: [] }); // 缺 yangshang, tabletAddress
  const b = checkUniversalSalvationItem("US_ZHENGHUN", { yangshangNames: [] }); // 缺 tabletAddress
  const c = combineCompleteness([a, b]);
  assert.equal(c.complete, false);
  // yangshang + tabletAddress 去重後各一。
  assert.deepEqual(c.missing.map((m) => m.field).sort(), ["tabletAddress", "yangshang"]);
});

test("未列管項目 → 視為完整不擋", () => {
  assert.equal(checkUniversalSalvationItem("SOME_OTHER", {}).complete, true);
});

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("完整度已接入普渡正式確認：缺資料回 422 INCOMPLETE_DATA、維持草稿", () => {
  const route = read("src/app/api/registrations/[ritualRecordId]/confirm/route.ts");
  assert.equal(route.includes("checkRitualRecordCompleteness"), true, "確認前套用完整度驗證");
  assert.equal(route.includes("incompleteDataPayload"), true);
  assert.equal(/if \(!completeness\.complete\)[\s\S]*?status: 422/.test(route), true, "缺資料回 422");
  // 確認流程順序：完整度擋關在 confirmRegistration 之前（不完整不進確認）。
  assert.ok(route.indexOf("checkRitualRecordCompleteness") < route.indexOf("confirmRegistration(ritualRecordId"));
  // GET 預檢一併回缺項。
  assert.equal(route.includes("missingFields:"), true);
});

test("完整度 gate 為純讀取（用 listRegisteredItems，不寫入）＋結構化回應", () => {
  const gate = read("src/lib/completenessGate.ts");
  assert.equal(gate.includes("listRegisteredItems"), true, "以純讀取的 listRegisteredItems 取項目");
  for (const forbidden of [".create(", ".update(", ".upsert(", ".delete("]) {
    assert.equal(gate.includes(forbidden), false, `gate 不應寫入（${forbidden}）`);
  }
  assert.equal(gate.includes('code: "INCOMPLETE_DATA"'), true);
  assert.equal(gate.includes("missingFields"), true);
});

test("gate 涵蓋年度燈／龍鳳燈（同確認路由自動 gating）＋規則六農曆換算", () => {
  const gate = read("src/lib/completenessGate.ts");
  assert.equal(gate.includes("checkAnnualLantern"), true, "年度燈完整度");
  assert.equal(gate.includes("checkDragonPhoenixLantern"), true, "龍鳳燈完整度");
  assert.equal(gate.includes("solarToLunar"), true, "國曆→農曆換算");
  assert.equal(gate.includes("resolveLunarAvailable"), true);
});

test("正式列印／補印 gating：print-items confirm 與 roster mark-printed 都先擋、缺資料回 422、不寫列印", () => {
  const printConfirm = read("src/app/api/universal-salvation/[year]/print-items/confirm/route.ts");
  assert.equal(printConfirm.includes("checkRitualRecordsCompleteness"), true);
  assert.ok(printConfirm.indexOf("checkRitualRecordsCompleteness") < printConfirm.indexOf("confirmPrintObjects("), "gating 在 confirmPrintObjects 之前");
  assert.equal(/allComplete[\s\S]*?status: 422/.test(printConfirm), true, "缺資料回 422");

  const roster = read("src/app/api/print-center/rosters/[itemKey]/[year]/mark-printed/route.ts");
  assert.equal(roster.includes("checkRitualRecordsCompleteness"), true);
  assert.ok(roster.indexOf("checkRitualRecordsCompleteness") < roster.indexOf("markRosterPrinted("), "gating 在 markRosterPrinted 之前");
  assert.equal(/allComplete[\s\S]*?status: 422/.test(roster), true, "缺資料回 422");
});

test("列印批次（print-batches）亦接 gating：缺資料回 422、在建立批次之前", () => {
  const route = read("src/app/api/universal-salvation/[year]/print-items/print-batches/route.ts");
  assert.equal(route.includes("checkRitualRecordsCompleteness"), true);
  assert.ok(route.indexOf("checkRitualRecordsCompleteness") < route.indexOf("generateAdditionalPrintItemBatch("), "gating 在產生批次之前");
  assert.equal(/allComplete[\s\S]*?status: 422/.test(route), true);
});

test("預覽提示：資料不完整顯示『本資料尚未完整』橫幅；列印中心接住 422 缺項", () => {
  const banner = read("src/components/universal-salvation/IncompletePreviewBanner.tsx");
  assert.equal(banner.includes("本資料尚未完整"), true);
  assert.equal(banner.includes("本畫面僅供預覽"), true);
  // 只在缺項時顯示、純顯示不寫入。
  assert.equal(banner.includes("missingFields.length === 0"), true, "無缺項不顯示");
  const center = read("src/components/universal-salvation/PrintObjectCenter.tsx");
  assert.equal(center.includes("IncompletePreviewBanner"), true);
  assert.equal(center.includes('data?.code === "INCOMPLETE_DATA"'), true, "接住 422 INCOMPLETE_DATA");
  assert.equal(center.includes("setIncompleteMissing"), true);
});

test("首頁資料待補：彙總／清單 API 與 summary lib 皆純讀取（無寫入）", () => {
  const summaryLib = read("src/lib/dataCompletenessSummary.ts");
  for (const forbidden of [".create(", ".update(", ".upsert(", ".delete(", ".updateMany(", ".deleteMany("]) {
    assert.equal(summaryLib.includes(forbidden), false, `彙總 lib 不應寫入（${forbidden}）`);
  }
  const summaryApi = read("src/app/api/data-completeness/summary/route.ts");
  const listApi = read("src/app/api/data-completeness/list/route.ts");
  assert.equal(summaryApi.includes('"view"'), true, "彙總 API view 權限（READONLY 可看）");
  assert.equal(listApi.includes('"view"'), true);
  // 待補頁：READONLY 不顯示寫入入口（前往補資料）。
  const page = read("src/app/data-completeness/page.tsx");
  assert.equal(page.includes("canEdit"), true);
  assert.equal(/canEdit &&[\s\S]*?前往補資料/.test(page), true, "只有可編輯角色顯示前往補資料");
});
