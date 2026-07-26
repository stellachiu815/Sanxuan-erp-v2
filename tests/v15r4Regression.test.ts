import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveImportAddress } from "../src/lib/purificationImportRules";
import { displayDebtCreditorName, DEBT_CREDITOR_CANONICAL } from "../src/lib/debtCreditorName";

/**
 * V15R4 正式站回歸修正——純函式＋source-scan 測試（沙盒可執行）。
 * 涵蓋：普渡地址優先序、累世冤親正名、年度燈統一（方案A）、祭改接通小人頭列印、
 * 中文輸入法搜尋共用、命名統一。DB 級行為（實際建立 PurificationEntry 等）見
 * v15r4RegressionDb.test.ts（待 Mac）。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── 二、普渡祖先地址：mapping→preview→payload 同一套優先序 ──────────────

test("普渡地址優先序：Excel該筆 → 配對信眾家戶 → 配對家戶", () => {
  // Excel 明確地址最高優先（牌位地址欄）。
  assert.deepEqual(resolveImportAddress({ rowTabletAddress: "台北市A路1號", matchedHouseholdAddress: "家戶地址" }), { address: "台北市A路1號", source: "Excel" });
  // 牌位地址欄空 → 退地址欄。
  assert.equal(resolveImportAddress({ rowAddress: "台北市B路2號" }).address, "台北市B路2號");
  // 無 Excel 地址 → 配對信眾主要地址（信眾所屬家戶）。
  assert.deepEqual(resolveImportAddress({ devoteeHouseholdAddress: "信眾家戶地址" }), { address: "信眾家戶地址", source: "信眾" });
  // 再退 → 配對家戶地址。
  assert.deepEqual(resolveImportAddress({ matchedHouseholdAddress: "家戶地址" }), { address: "家戶地址", source: "家戶" });
  // 全無 → null（保留草稿、標缺牌位地址）。
  assert.deepEqual(resolveImportAddress({}), { address: null, source: null });
});

test("普渡地址：preview 與 commit 共用同一 resolveImportAddress（不再兩套）", () => {
  const importLib = read("src/lib/purificationImport.ts");
  // preview（enriched）帶入 Excel 該筆地址。
  assert.equal(importLib.includes("rowTabletAddress: nd?.tabletAddress"), true, "preview 帶 Excel 牌位地址");
  // commit 將解析後地址「寫入」entry（非只顯示 preview）。
  assert.equal(importLib.includes("resolvedTabletAddress"), true, "commit 計算並寫入解析地址");
  assert.equal(/tabletAddress: resolvedTabletAddress/.test(importLib), true, "entry 寫入解析後地址");
});

// ── 三、累世冤親債主辨識與正名 ────────────────────────────────

test("累世冤親正名：三種輸入辨識、輸出一律累世冤親債主", () => {
  assert.equal(displayDebtCreditorName("冤親債主"), DEBT_CREDITOR_CANONICAL);
  assert.equal(displayDebtCreditorName("歷世冤親債主"), DEBT_CREDITOR_CANONICAL);
  assert.equal(displayDebtCreditorName("累世冤親債主"), DEBT_CREDITOR_CANONICAL);
  // 帶編號（批次牌位）。
  assert.equal(displayDebtCreditorName("冤親債主（3）"), "累世冤親債主（3）");
  assert.equal(displayDebtCreditorName("歷世冤親債主(5)"), "累世冤親債主（5）");
  // 非變體姓名原樣不動（不誤改真實姓名）。
  assert.equal(displayDebtCreditorName("王大明"), "王大明");
  assert.equal(displayDebtCreditorName("周姓歷代祖先"), "周姓歷代祖先");
  assert.equal(displayDebtCreditorName(""), "");
});

test("累世冤親：匯入類別別名含歷世、列印/顯示層套用正名", () => {
  const importLib = read("src/lib/purificationImport.ts");
  assert.equal(importLib.includes("歷世冤親債主: \"DEBT_CREDITOR\""), true, "辨識歷世冤親債主");
  // 牌位模板顯示走正名。
  const shared = read("src/components/ritual/tablets/shared.ts");
  assert.equal(shared.includes("displayDebtCreditorName(entry.displayName)"), true, "列印牌位套用正名");
  // types.ts 類別標題已正名。
  const types = read("src/components/ritual/types.ts");
  assert.equal(types.includes('title: "累世冤親債主"'), true);
  assert.equal(types.includes('title: "冤親債主"'), false, "不得殘留舊標題");
});

// ── 四、年度燈正式架構：單一 ANNUAL_LANTERN TempleEvent ──────────────

test("年度燈正式架構：每年單一 ANNUAL_LANTERN TempleEvent，不再四個獨立事件", () => {
  const templeEvents = read("src/lib/templeEvents.ts");
  assert.equal(templeEvents.includes("createAnnualLanternGroup"), true);
  // 建立單一 ANNUAL_LANTERN 事件（沿用 createTempleEvent），非四個獨立事件。
  assert.equal(/createTempleEvent\(\{ \.\.\.input, activityType: "ANNUAL_LANTERN"/.test(templeEvents), true, "建立單一年度燈事件");
  assert.equal(templeEvents.includes('registrationFormType: "LANTERN"'), true, "年度燈報名表型態");

  const wizard = read("src/components/activities/ActivityWizard.tsx");
  assert.equal(wizard.includes('activityType === "ANNUAL_LANTERN"'), true, "精靈年度燈分支");
  assert.equal(wizard.includes("/api/temple-events/annual-lantern"), true);

  const labels = read("src/lib/labels.ts");
  assert.equal(labels.includes('value: "ANNUAL_LANTERN"'), true, "精靈選項改為年度燈");
  assert.equal(labels.includes('{ value: "GUANGMING_LANTERN", label: "光明燈" }'), false, "不再個別建立三燈");
});

test("年度燈 migration：四個 RegistrationItemType 統一為 ANNUAL_LANTERN（不改結構/enum）", () => {
  const mig = read("prisma/migrations/20260810000000_v15r4_annual_lantern_unify/migration.sql");
  assert.equal(/UPDATE "registration_item_types"[\s\S]*SET "activityType" = 'ANNUAL_LANTERN'/.test(mig), true);
  for (const k of ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY", "LANTERN_PURIFICATION"]) {
    assert.equal(mig.includes(k), true, `涵蓋 ${k}`);
  }
  // 不新增欄位/enum/資料表（純資料 UPDATE）。
  assert.equal(/ALTER TABLE|CREATE TABLE|ADD COLUMN|ALTER TYPE/.test(mig), false, "不改結構/enum");
});

test("祭改不再獨立事件：祭改模組同時接受 ANNUAL_LANTERN（新）與 PURIFICATION（舊相容）", () => {
  const pur = read("src/lib/purification.ts");
  assert.equal(pur.includes("export function isPurificationEvent"), true);
  assert.equal(/return activityType === "ANNUAL_LANTERN" \|\| activityType === "PURIFICATION"/.test(pur), true);
  // 年度清單一併列出年度燈與舊祭改事件。
  assert.equal(pur.includes('activityType: { in: ["ANNUAL_LANTERN", "PURIFICATION"] }'), true);
  // findPurificationEvent 優先年度燈。
  assert.equal(pur.includes('activityType: "ANNUAL_LANTERN", year'), true);
});

// ── 五＋六、祭改接通小人頭列印（多人多項目報名建立 PurificationEntry）──

test("祭改接通：報名批次遇 PURIFICATION 內容型態 → 同 tx 於年度燈事件下建 PurificationEntry", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("createPurificationEntryForRecordInTx"), true, "呼叫祭改 tx 建立器");
  assert.equal(reg.includes('p.itemType.contentKind === "PURIFICATION"'), true, "以內容型態判斷祭改");
  // 祭改事件＝年度燈事件（ANNUAL_LANTERN），非獨立 PURIFICATION 事件。
  // V15R5：年度燈事件 id 於交易外預取（annualEventIdByYear），祭改掛在該事件下。
  assert.equal(reg.includes("annualEventIdByYear"), true, "祭改掛在（交易外預取的）年度燈事件下");
  assert.equal(reg.includes('activityType: "ANNUAL_LANTERN", year: entry.year'), true, "以 ANNUAL_LANTERN 事件為祭改事件");
  const pur = read("src/lib/purification.ts");
  assert.equal(pur.includes("export async function createPurificationEntryForRecordInTx"), true);
  assert.equal(pur.includes("skipped: true"), true, "祭改建立冪等（對應 ALREADY_EXISTS）");
  assert.equal(pur.includes("assignSequentialNumbers"), true, "沿用既有編號規則");
});

// ── 五、全戶多人多項目 picker（三入口共用同一後端與資料模型）───────────

test("全戶多人 picker：三入口共用同一元件、同一 /api/registrations/batch 後端", () => {
  const picker = read("src/components/lantern/AnnualLanternHouseholdPicker.tsx");
  // 每位成員可分別勾選光明/太歲/祭改。
  for (const k of ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_PURIFICATION", "LANTERN_FAMILY"]) {
    assert.equal(picker.includes(k), true, `picker 含 ${k}`);
  }
  // 一次送出到既有整批 API（單一 transaction、ALREADY_EXISTS 由後端處理）。
  assert.equal(picker.includes("/api/registrations/batch"), true);
  assert.equal(picker.includes("ALREADY_EXISTS"), true);
  // 全家燈 6～13 位、帶 participantMemberIds。
  assert.equal(picker.includes("participantMemberIds"), true);

  // 三入口都掛同一顆 picker 按鈕。
  const btn = "AnnualLanternPickerButton";
  for (const f of [
    "src/app/devotee-center/[memberId]/page.tsx",
    "src/app/household/[id]/page.tsx",
    "src/components/activities/ActivityHomeScreen.tsx",
  ]) {
    assert.equal(read(f).includes(btn), true, `${f} 掛 picker 入口`);
  }
  // 後端整批項目支援全家燈成員清單（同一 tx 寫入參加者，不建第二套）。
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("participantMemberIds"), true);
  assert.equal(reg.includes("participantIdsFor"), true);
});

// ── 列印資料串接：全部自動引用既有資料，無需再次人工輸入 ───────────────

test("祭改列印串接：picker 建立的祭改一路自動引用既有資料，零人工再輸入", () => {
  const pur = read("src/lib/purification.ts");
  // 1) 建立祭改一律 memberId-based、非臨時報名、不寫任何 manual* 欄位 → 全靠信眾/家戶自動帶入。
  const fn = pur.slice(pur.indexOf("createPurificationEntryForRecordInTx"), pur.indexOf("registerPurificationEntrant"));
  assert.equal(fn.includes("isTemporaryName: false"), true, "祭改非臨時報名");
  assert.equal(fn.includes("memberId: params.memberId"), true, "以信眾 memberId 建立");
  assert.equal(/manualDisplayName|manualGender|manualSolarBirthDate|manualAddress/.test(fn), false, "不寫任何人工輸入欄位");

  // 2) 列印預覽/正式列印讀 PurificationEntry 並自動帶出 member＋household（姓名/性別/生日/地址）。
  assert.equal(pur.includes("include: { member: true, ritualRecord: { include: { household: true } } }"), true, "列印自動引用信眾/家戶");
  // 3) 姓名/性別/農曆生日來自 member；地址來自 household（resolvePurificationRegistrationView）。
  const view = pur.slice(pur.indexOf("export function resolvePurificationRegistrationView"), pur.indexOf("export function resolvePurificationRegistrationView") + 1600);
  assert.equal(view.includes("entry.member!.name"), true, "姓名自動引用信眾");
  assert.equal(view.includes("entry.member!.gender"), true, "性別自動引用信眾");
  assert.equal(view.includes("entry.ritualRecord.household?.address"), true, "地址自動引用家戶");
  // 4) 年度虛歲由生日＋活動年度自動計算（buildPurificationPrintFields(view, targetYear...)）。
  assert.equal(pur.includes("buildPurificationPrintFields(view, targetYear"), true, "年度虛歲自動計算");
});

test("祭改列印串接：預覽/正式列印/總覽/年度清單皆接受年度燈事件（ANNUAL_LANTERN），沿用既有列印架構", () => {
  const pur = read("src/lib/purification.ts");
  // 預覽、正式列印、總覽、就緒檢查全部用 isPurificationEvent（含 ANNUAL_LANTERN）。
  assert.ok((pur.match(/isPurificationEvent\(event\.activityType\)/g) ?? []).length >= 5, "各列印/查詢入口皆接受年度燈事件");
  // 沿用既有列印紀錄機制（TempleEventPrintBatch），不另寫第二套 HTML 列印流程。
  assert.equal(pur.includes("TempleEventPrintBatch") || pur.includes("templeEventPrintBatch"), true, "沿用既有列印批次紀錄");
  // 就緒檢查沿用既有 checkPurificationPrintReadiness（不自製新版型定位）。
  assert.equal(pur.includes("checkPurificationPrintReadiness") || pur.includes("readiness"), true, "沿用既有列印就緒檢查");
  // 不建立第二套列印資料：祭改資料只有 PurificationEntry 一份（無平行報名主檔）。
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("createPurificationEntryForRecordInTx"), true, "祭改只寫入既有 PurificationEntry");
});

test("年度燈列印串接：光明/太歲/全家燈列印讀 item-based 資料（信眾/家戶/報名），不建第二套模型", () => {
  const lp = read("src/lib/lanternPrint.ts");
  // 事件優先取單一年度燈事件（ANNUAL_LANTERN），相容舊 per-type 事件。
  assert.equal(lp.includes('activityType: "ANNUAL_LANTERN", year'), true, "以年度燈事件為主");
  // 讀該燈項目的 RitualRegistrationItem → member ＋ ritualRecord.household（報名/信眾/家戶）。
  assert.equal(lp.includes("ritualRegistrationItem.findMany"), true, "讀 item-based 報名資料");
  assert.equal(lp.includes("LANTERN_GUANGMING") && lp.includes("LANTERN_TAISUI") && lp.includes("LANTERN_FAMILY"), true, "三燈對應項目型別");
  assert.equal(lp.includes("ritualRecord: { include: { household"), true, "地址引用家戶");
  assert.equal(lp.includes("member: true"), true, "姓名/生日引用信眾");
  // 不新增列印資料模型：仍讀既有 RitualRegistrationItem / RitualRecord / Member / Household。
  assert.equal(/create(Many)?\(/.test(lp.split("buildPetitionData")[0]), false, "列印純讀取、不建立任何新資料");
});

// ── 六、中文輸入法搜尋共用 ────────────────────────────────

test("中文搜尋共用：組字期間不查、compositionEnd 查一次、防舊蓋新", () => {
  const hook = read("src/lib/useComposedSearch.ts");
  assert.equal(hook.includes("onCompositionStart"), true);
  assert.equal(hook.includes("onCompositionEnd"), true);
  assert.equal(hook.includes("composingRef.current"), true, "isComposing 守衛");
  assert.equal(hook.includes("useRequestSeq"), true, "防舊回應覆蓋新結果");

  // 三入口共用同一 Hook（不可只修首頁一個）。
  for (const f of [
    "src/components/SearchBar.tsx",
    "src/components/purification/RegisterEntrantModal.tsx",
    "src/components/activities/ActivityHomeScreen.tsx",
  ]) {
    assert.equal(read(f).includes("useComposedSearch"), true, `${f} 共用搜尋 Hook`);
  }
  // SearchBar 用 committedQuery（組字完成才查）＋序號防舊蓋新。
  const sb = read("src/components/SearchBar.tsx");
  assert.equal(sb.includes("committedQuery"), true);
  assert.equal(sb.includes("reqSeq.isLatest"), true);
});

// ── 七、命名統一（中心 → 管理）────────────────────────────

test("命名統一：首頁快捷入口與主要標題改為『管理』", () => {
  const nav = read("src/components/dashboard/HomeQuickNav.tsx");
  for (const label of ["信眾管理", "收款管理", "列印管理", "活動管理", "供品管理"]) {
    assert.equal(nav.includes(label), true, `快捷入口含 ${label}`);
  }
  // 首頁入口不得殘留舊「中心」標籤。
  assert.equal(/label: "信眾中心"/.test(nav), false);
  assert.equal(/label: "收款中心"/.test(nav), false);
  // 主要標題已改（活動管理）。
  assert.equal(read("src/components/activities/ActivityListScreen.tsx").includes('>活動管理<'), true);
});
