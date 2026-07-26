import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeGender, formatJishi } from "../src/lib/chineseNumerals";
import { parseFlexibleDate, minguoToAD, adToMinguo } from "../src/lib/minguoDate";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

// ── 9. 登入與首頁效能 ─────────────────────────────────────────
test("登入：成功後整頁導向（避免軟導覽 cookie 競態，一次登入成功）", () => {
  const login = read("src/app/login/LoginContent.tsx");
  assert.equal(login.includes("window.location.assign(next)"), true, "整頁導向");
  assert.equal(/router\.replace\(next\)/.test(login), false, "不再用軟導覽");
});

test("首頁效能：/api/auth/me 與 /api/system/users 跨 Provider 去重（module 級 in-flight 快取）", () => {
  const op = read("src/lib/operatorClient.tsx");
  assert.equal(op.includes("sharedMePromise"), true);
  assert.equal(op.includes("sharedUsersPromise"), true);
  assert.equal(op.includes("fetchMeShared"), true);
  assert.equal(op.includes("fetchUsersShared"), true);
  assert.equal(op.includes("resetSharedOperatorCaches"), true, "reload 時清快取");
});

// ── 1/4. 民國生日輸入與解析 ───────────────────────────────────
test("民國解析：46/4/17 = 民國46（西元1957），不得被當成西元1946", () => {
  const r = parseFlexibleDate("46/4/17");
  assert.equal(r.ok, true);
  if (r.ok) {
    assert.equal(r.minguoYear, 46, "民國年 46");
    assert.equal(r.date.getUTCFullYear(), 1957, "西元 1957（46+1911），非 1946");
  }
  assert.equal(minguoToAD(46), 1957);
  assert.equal(adToMinguo(1957), 46);
  // 分隔式與純數字皆以民國解讀（年 < 1000）。
  assert.equal((parseFlexibleDate("46-4-17") as { ok: true; date: Date }).date.getUTCFullYear(), 1957);
});

test("民國生日全年份：35/46/99/100/115 一律民國、正確轉西元，且回推民國一致", () => {
  const cases: [string, number, number][] = [
    // 輸入(民國/月/日), 期望民國年, 期望西元年
    ["35/1/1", 35, 1946],
    ["46/4/17", 46, 1957],
    ["99/12/31", 99, 2010],
    ["100/6/15", 100, 2011],
    ["115/7/26", 115, 2026],
  ];
  for (const [input, roc, ad] of cases) {
    const r = parseFlexibleDate(input);
    assert.equal(r.ok, true, `${input} 應可解析`);
    if (r.ok) {
      assert.equal(r.minguoYear, roc, `${input} 民國年應為 ${roc}`);
      assert.equal(r.date.getUTCFullYear(), ad, `${input} 西元年應為 ${ad}`);
      assert.equal(minguoToAD(roc), ad);
      assert.equal(adToMinguo(ad), roc);
    }
  }
  // 空白生日：不得補今天、回 not ok。
  assert.equal(parseFlexibleDate("").ok, false);
  assert.equal(parseFlexibleDate(null).ok, false);
  // 特別確認 46 不會變成 1946＋不會被當西元。
  assert.notEqual((parseFlexibleDate("46/4/17") as { ok: true; date: Date }).date.getUTCFullYear(), 1946);
});

test("BirthdayField：畫面一律民國輸入/顯示，內部才轉西元", () => {
  const bf = read("src/components/birthday/BirthdayField.tsx");
  assert.equal(bf.includes("國曆生日（民國年"), true, "國曆改民國文字輸入");
  assert.equal(bf.includes("年（民國）"), true, "農曆年改民國");
  assert.equal(bf.includes('placeholder="年（西元）"'), false, "不再要求西元");
  assert.equal(bf.includes("parseFlexibleDate"), true, "民國→西元用共用解析");
  assert.equal(bf.includes("民國 {adToMinguo(c.lunarYear)}"), true, "候選年顯示民國");
  assert.equal(/type="date"/.test(bf), false, "不用瀏覽器西元日期選擇器");
});

// ── 5. 性別 ───────────────────────────────────────────────────
test("性別：男→建生、女→瑞生、空白/未知→不顯示（不猜測）", () => {
  assert.equal(normalizeGender("男"), "MALE");
  assert.equal(normalizeGender("女"), "FEMALE");
  assert.equal(normalizeGender(""), "UNKNOWN");
  assert.equal(normalizeGender(null), "UNKNOWN");
  assert.equal(normalizeGender("X"), "UNKNOWN");
  assert.equal(formatJishi(normalizeGender("男")), "吉時建生");
  assert.equal(formatJishi(normalizeGender("女")), "吉時瑞生");
  assert.equal(formatJishi(normalizeGender("")), null, "空白不顯示建生/瑞生");
});

// ── 2. 祭改／全家燈金額與金流（不雙重應收）──────────────────────
test("金流：祭改收款走 PurificationEntry（feeStatus/amountDue）、item 一律 0，不雙重", () => {
  const pur = read("src/lib/purification.ts");
  assert.equal(pur.includes("getAnnualLanternPrices"), true);
  assert.equal(/feeStatus: chargeable \? "CHARGEABLE" : "UNSET"/.test(pur), true, "祭改在 PurificationEntry 收費");
  // 祭改 item（LANTERN_PURIFICATION，feeMode NONE）amountDue 為 0（computeItemAmountDue）。
  const items = read("src/lib/registrationItems.ts");
  assert.equal(items.includes('"NONE"'), true);
});

test("金流：全家燈自身計價（RitualRegistrationItem），年度統一不路由 LanternRegistration（避免覆蓋/雙重）", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  // 年度燈統一後 LANTERN 不再歸零/路由 LanternRegistration。
  assert.equal(/if \(params\.activityType === "ANNUAL_LANTERN"\) return;/.test(reg), true, "ANNUAL_LANTERN 不路由 LanternRegistration");
  // 全家燈以年度單價計價、整戶一筆（qty=1）；V15R5.1 起四項年度價統一由 annualLanternItemUnitPrice
  // 依項目 key 取該年度 TempleEvent 欄位（familyLanternUnitPrice 對照現移至 annualLanternPricing.ts）。
  assert.equal(reg.includes('p.itemType.key === "LANTERN_FAMILY"'), true, "全家燈整戶一筆 qty=1");
  assert.equal(reg.includes("annualLanternItemUnitPrice"), true, "四項年度價依 key 取（含全家燈）");
  assert.equal(read("src/lib/annualLanternPricing.ts").includes("familyLanternUnitPrice"), true, "全家燈年度欄位對照在唯一價格層");
  // 收款來源 adapter 已註冊三種年度燈項目（自身計價），祭改不在其中。
  const adapters = read("src/lib/receivableAdapters.ts");
  assert.equal(adapters.includes('"ANNUAL_LANTERN_ITEM"'), true);
  assert.equal(/\["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY"\]/.test(adapters), true);
  assert.equal(adapters.includes("annualLanternItemAdapter"), true);
});

test("金額：schema 與 migration 只新增必要欄位/enum，不改既有金流", () => {
  const schema = read("prisma/schema.prisma");
  assert.equal(schema.includes("purificationUnitPrice  Decimal?"), true);
  assert.equal(schema.includes("familyLanternUnitPrice Decimal?"), true);
  assert.equal(schema.includes("ANNUAL_LANTERN_ITEM"), true);
  const m1 = read("prisma/migrations/20260811000000_v15r5_annual_lantern_prices/migration.sql");
  assert.equal(/ADD COLUMN IF NOT EXISTS "purificationUnitPrice"/.test(m1), true);
  assert.equal(/ADD COLUMN IF NOT EXISTS "familyLanternUnitPrice"/.test(m1), true);
  assert.equal(/CREATE TABLE|DROP/.test(m1), false, "不建表/不刪除");
  const m2 = read("prisma/migrations/20260811000001_v15r5_annual_lantern_item_source/migration.sql");
  assert.equal(/ADD VALUE IF NOT EXISTS 'ANNUAL_LANTERN_ITEM'/.test(m2), true);
});

// ── V15R5.1：年度燈四項目各自逐年單價（光明/太歲不再讀 defaultUnitPrice、不寫死 500）──
test("V15R5.1：schema 新增光明燈/太歲燈年度單價欄位", () => {
  const schema = read("prisma/schema.prisma");
  assert.equal(schema.includes("brightLightUnitPrice   Decimal?"), true, "光明燈年度單價欄位");
  assert.equal(schema.includes("taisuiLightUnitPrice   Decimal?"), true, "太歲燈年度單價欄位");
});

test("V15R5.1：migration 只 ADD COLUMN，不 backfill（不覆蓋既有年度價、不刪資料、不硬寫 500）", () => {
  const m = read("prisma/migrations/20260812000000_v15r5_1_lantern_item_prices/migration.sql");
  // 只檢查「可執行 SQL」（濾掉 -- 註解行；註解可自由說明 500/backfill 背景）。
  const sql = m
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  assert.equal(/ADD COLUMN IF NOT EXISTS "brightLightUnitPrice"/.test(sql), true);
  assert.equal(/ADD COLUMN IF NOT EXISTS "taisuiLightUnitPrice"/.test(sql), true);
  assert.equal(/CREATE TABLE|DROP|DELETE/.test(sql), false, "不建表/不刪除");
  // 不得主動寫入 TempleEvent（不 UPDATE/backfill）——避免覆蓋既有不同年度價格。
  assert.equal(/UPDATE/i.test(sql), false, "不得 backfill 覆蓋既有年度價");
  assert.equal(/\b500\b/.test(sql), false, "SQL 不得硬寫 500");
});

test("V15R5.1：預設值改由設定畫面預帶——API 回 defaults、UI 按儲存才寫入", () => {
  // API GET 回傳各項目 defaultUnitPrice 作為建議預設（供首次開啟預帶顯示，尚未寫入 DB）。
  const api = read("src/app/api/temple-events/[id]/annual-lantern-prices/route.ts");
  assert.equal(api.includes("defaults"), true, "GET 回傳 defaults 建議值");
  assert.equal(api.includes("defaultUnitPrice"), true, "來源＝RegistrationItemType.defaultUnitPrice");
  // UI：DB 為 NULL 時預帶建議值、標記尚未儲存；只有按「儲存單價」才寫入。
  const ui = read("src/components/activities/AnnualLanternPriceSettings.tsx");
  assert.equal(ui.includes("data?.defaults"), true, "UI 讀 API defaults 預帶");
  assert.equal(ui.includes("尚未儲存"), true, "顯示『尚未儲存』提示");
});

test("V15R5.1：annualLanternPricing 四項唯一讀寫層（key→年度欄位對照，光明/太歲入列）", () => {
  const p = read("src/lib/annualLanternPricing.ts");
  for (const f of ["brightLightUnitPrice", "taisuiLightUnitPrice", "familyLanternUnitPrice", "purificationUnitPrice"]) {
    assert.equal(p.includes(f), true, `含 ${f}`);
  }
  assert.equal(p.includes("ANNUAL_LANTERN_ITEM_PRICE_FIELD"), true, "項目 key→欄位對照表");
  assert.equal(/LANTERN_GUANGMING: "brightLightUnitPrice"/.test(p), true);
  assert.equal(/LANTERN_TAISUI: "taisuiLightUnitPrice"/.test(p), true);
  assert.equal(p.includes("isAnnualLanternPricedItemKey"), true);
});

test("V15R5.1：報名計價——光明/太歲/全家燈改讀年度單價，光明/太歲不再走 defaultUnitPrice", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  // 使用年度四項單價的唯一來源與 key→欄位對照。
  assert.equal(reg.includes("isAnnualLanternPricedItemKey"), true, "以項目 key 判定年度燈計價");
  assert.equal(reg.includes("annualLanternItemUnitPrice"), true, "依 key 取該年度單價");
  // pre-fetch 條件已改成 isAnnualLanternPricedItemKey（不再只有 LANTERN_FAMILY）。
  assert.equal(/needsAnnual = isAnnualLanternPricedItemKey\(itemType\.key\)/.test(reg), true);
  // 光明/太歲不再以 defaultUnitPrice×qty 計價（該分支僅剩非年度燈項目走 computeItemAmountDue）。
  assert.equal(/光明\/太歲燈用項目 defaultUnitPrice/.test(reg), false, "移除『光明/太歲用 defaultUnitPrice』舊註解與邏輯");
});

// ── V15R5.3 全家燈永久資料共用架構 Phase 2（只全家燈）──
test("V15R5.3 schema：全家燈兩張專屬表（正式 FK；防重＝ritualRecord+household；成員 Restrict 保護歷史）", () => {
  const s = read("prisma/schema.prisma");
  assert.equal(s.includes("model FamilyLanternRegistration"), true, "FamilyLanternRegistration");
  assert.equal(s.includes("model FamilyLanternMember"), true, "FamilyLanternMember");
  assert.equal(s.includes("ritualRegistrationItemId String                  @unique") || /ritualRegistrationItemId String\s+@unique/.test(s), true, "全家燈 item 1:1 @unique");
  assert.equal(/@@unique\(\[ritualRecordId, householdId\]\)/.test(s), true, "防重＝(ritualRecordId, householdId)，非單純 year");
  assert.equal(/member   Member @relation\(fields: \[memberId\], references: \[id\], onDelete: Restrict\)/.test(s), true, "成員 FK Restrict（不 Cascade 刪歷史快照）");
  assert.equal(s.includes("addressSnapshot") && s.includes("contactNameSnapshot") && s.includes("contactSourceSnapshot") && s.includes("memberNameSnapshot"), true, "地址/戶主/成員姓名快照欄位");
});

test("V15R5.3 migration：純新增兩表（CREATE TABLE）、不改既有資料；成員 FK RESTRICT", () => {
  const m = read("prisma/migrations/20260813000000_v15r5_3_family_lantern_snapshot/migration.sql");
  assert.equal(/CREATE TABLE "family_lantern_registrations"/.test(m), true);
  assert.equal(/CREATE TABLE "family_lantern_members"/.test(m), true);
  assert.equal(/family_lantern_members_memberId_fkey[\s\S]*ON DELETE RESTRICT/.test(m), true, "成員 FK RESTRICT 保護歷史");
  assert.equal(/ALTER TABLE "(ritual_registration_items|households|members|ritual_records)"[\s\S]*(DROP|ALTER COLUMN)/.test(m), false, "不改既有表欄位");
  assert.equal(/UNIQUE INDEX "family_lantern_registrations_ritualRecordId_householdId_key"/.test(m), true);
});

test("V15R5.3 service：registerItemsBatch 全家燈以 (record, LANTERN_FAMILY) 防重＋寫年度快照", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("writeFamilyLanternSnapshotInTx"), true, "交易內寫快照");
  assert.equal(/p\.itemType\.key === "LANTERN_FAMILY"/.test(reg), true, "全家燈專屬分支");
  // 全家燈防重不以第一位成員區分（findFirst 不含 memberId）。
  assert.equal(/ritualRecordId: recordId, registrationItemTypeId: p\.itemType\.id, deletedAt: null, status: \{ not: "CANCELLED" \}/.test(reg), true, "以 (record, itemType) 防重");
  const fam = read("src/lib/familyLantern.ts");
  assert.equal(fam.includes("isDeceased: false") && fam.includes("deletedAt: null"), true, "合格＝在世且未刪除");
  assert.equal(fam.includes("HOUSEHOLD_HEAD") && fam.includes("isPrimaryContact") && fam.includes("contactName"), true, "戶主優先序 HEAD→PRIMARY→contactName");
  assert.equal(fam.includes('source: "UNSET"'), true, "無資料＝UNSET（不存『尚未設定』）");
  assert.equal(fam.includes("至少需納入一位有效成員"), true, "至少一位");
});

test("V15R5.3 UI：全家燈預設全納入合格成員、全部納入/取消納入、戶主+地址摘要、手機置頂", () => {
  const p = read("src/components/lantern/AnnualLanternHouseholdPicker.tsx");
  assert.equal(p.includes("eligibleMemberIds"), true, "讀合格成員預設全納入");
  assert.equal(p.includes("全部納入"), true, "全部納入按鈕");
  assert.equal(p.includes("取消納入") && p.includes("納入"), true, "逐位納入/取消納入");
  assert.equal(p.includes("戶主／主要聯絡人"), true, "顯示戶主/主要聯絡人");
  assert.equal(p.includes("contactDisplay"), true, "UNSET→尚未設定（畫面轉換）");
  assert.equal(p.includes("sm:flex-row-reverse"), true, "桌機摘要靠右、手機置頂");
  assert.equal(/FAMILY_MIN|FAMILY_MAX/.test(p), false, "移除 6～13 硬限制（改至少一位）");
});

test("V15R5.1 UI：已報名項目每列顯示報名者（it.memberName，非僅 RICE）、欄序正確、手機有姓名", () => {
  const panel = read("src/components/registration/RegisteredItemsPanel.tsx");
  // 桌機表頭含「報名者」欄，且欄序＝報名者→類別｜名稱→數量→應收→未收→狀態。
  assert.equal(panel.includes("報名者"), true, "有報名者欄");
  assert.equal(
    /報名者[\s\S]*類別｜名稱[\s\S]*數量[\s\S]*應收[\s\S]*未收[\s\S]*狀態/.test(panel),
    true,
    "欄位順序：報名者｜類別/名稱｜數量｜應收｜未收｜狀態"
  );
  // 姓名一律用 memberName（不再只對 RICE 顯示「認購人」）。
  assert.equal(panel.includes("it.memberName"), true, "使用 it.memberName");
  // 白米不再以「認購人：姓名」重複顯示（姓名改由報名者欄呈現）；只檢查渲染字樣，不含註解。
  assert.equal(/認購人：/.test(panel), false, "白米不再重複渲染『認購人：』（改由報名者欄呈現）");
  // 手機版卡片：直接顯示「報名者：姓名」＋數量/應收/未收/狀態/取消。
  assert.equal(panel.includes("sm:hidden"), true, "手機卡片版存在");
  assert.equal(panel.includes("報名者："), true, "手機直接顯示報名者姓名");
  assert.equal(panel.includes("hidden w-full") && panel.includes("sm:table"), true, "桌機表格 sm:table、手機隱藏");
  // 不退步：仍顯示 displayLabel、陽上、牌位地址、單價，取消仍以 item.id。
  for (const s of ["displayLabel", "陽上：", "牌位地址：", "單價", "cancelItem(it.id)"]) {
    assert.equal(panel.includes(s), true, `保留 ${s}`);
  }
});

test("V15R5.1：年度單價 API 與 UI 皆含四項", () => {
  const api = read("src/app/api/temple-events/[id]/annual-lantern-prices/route.ts");
  for (const f of ["brightLightUnitPrice", "taisuiLightUnitPrice", "familyLanternUnitPrice", "purificationUnitPrice"]) {
    assert.equal(api.includes(f), true, `API 處理 ${f}`);
  }
  const ui = read("src/components/activities/AnnualLanternPriceSettings.tsx");
  assert.equal(ui.includes("年度燈單價設定"), true, "標題不變");
  for (const name of ["光明燈", "太歲燈", "全家燈", "祭改"]) {
    assert.equal(ui.includes(name), true, `UI 顯示 ${name}`);
  }
  assert.equal(ui.includes("儲存單價"), true, "單一儲存按鈕");
});

// ── 7/10. 家戶成員報名活動（回歸）────────────────────────────
test("家戶成員可報名活動：沿用信眾詳情同一套 NewActivityRegistrationDialog（memberId 傳遞）", () => {
  const btn = read("src/components/devotee/MemberRegisterButton.tsx");
  assert.equal(btn.includes("NewActivityRegistrationDialog"), true);
  assert.equal(btn.includes("memberId={memberId}"), true);
  const page = read("src/app/household/[id]/page.tsx");
  assert.equal(page.includes("MemberRegisterButton"), true);
  assert.equal(page.includes("memberId={m.id}"), true, "傳入每位成員 memberId");
});

// ── 4. 累世冤親債主格式 ───────────────────────────────────────
test("冤親顯示固定「累世冤親債主｜姓名」（非「姓名之…」）", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("`${displayDebtCreditorName(categoryName)}｜${subjectName}`"), true);
});

// ── 2/3. Excel 生日後端民國解析 ───────────────────────────────
test("Excel 生日後端：國曆用 parseFlexibleDate（民國）、農曆年 <1000 視民國+1911", () => {
  const person = read("src/lib/devoteeImportPersonSheet.ts");
  // 國曆生日：走 parseFlexibleDate（民國辨識）。
  assert.equal(person.includes("parseFlexibleDate(raw)"), true, "國曆生日民國解析");
  // 農曆生日：年 <1000 視民國、+1911 轉西元（一次轉換），不再強制 4 碼西元。
  assert.equal(person.includes("yRaw < 1000 ? yRaw + 1911 : yRaw"), true, "農曆年民國→西元");
  assert.equal(/\/\^\(\\d\{4\}\)-/.test(person), false, "農曆不再強制 4 碼西元");
});

test("Excel 字串/數值日期：字串民國可解析；純數字（Excel serial 非民國）→ Excel 序列", () => {
  // 字串民國。
  assert.equal((parseFlexibleDate("46-4-17") as { ok: true; date: Date }).date.getUTCFullYear(), 1957);
  // 7 碼純數字民國（1140721）＝民國114。
  const r = parseFlexibleDate(1140721);
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.date.getUTCFullYear(), 2025);
});

// ── 沿用去年 carry-over ───────────────────────────────────────
test("沿用去年：讀去年報名內容、以新年度重算（不帶付款/收據/列印狀態）", () => {
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("getHouseholdAnnualLanternLastYear"), true, "carry-over 讀取函式");
  // 只讀項目/成員（不讀 amountPaid/收據/printed）。
  const fn = reg.slice(reg.indexOf("export async function getHouseholdAnnualLanternLastYear"), reg.indexOf("export async function getHouseholdAnnualLanternLastYear") + 1400);
  assert.equal(/amountPaid|printedAt|printCount|receipt/i.test(fn), false, "carry-over 不讀付款/列印狀態");
  // picker 提供「沿用去年 / 全新建立」，送出走既有 registerItemsBatch（新年度重算單價）。
  const picker = read("src/components/lantern/AnnualLanternHouseholdPicker.tsx");
  assert.equal(picker.includes("沿用去年"), true);
  assert.equal(picker.includes("全新建立"), true);
  assert.equal(picker.includes("applyLastYear"), true);
  // 端點回傳 lastYear。
  assert.equal(read("src/app/api/households/[id]/annual-lantern-options/route.ts").includes("lastYear"), true);
});

test("沿用去年接到 NewActivityRegistrationDialog（年度燈/宮慶/普渡/補庫等同一對話框）", () => {
  const dlg = read("src/components/devotee/NewActivityRegistrationDialog.tsx");
  assert.equal(dlg.includes("沿用去年資料"), true, "對話框有沿用去年入口");
  assert.equal(dlg.includes("/api/registrations/carry-over"), true, "呼叫共用 carry-over 端點");
  assert.equal(dlg.includes("group.items[0]?.activityType"), true, "依主活動類型 carry-over");
  // carry-over 端點依活動類型：item-based 走 registerItemsBatch；普渡另複製牌位。
  const route = read("src/app/api/registrations/carry-over/route.ts");
  assert.equal(route.includes("carryOverHouseholdRegistration"), true);
  assert.equal(route.includes("carryOverUniversalSalvationEntries"), true);
});

test("普渡沿用去年：每筆牌位含自己的 tabletAddress、DRAFT、不帶付款/列印（新年度重算價）", () => {
  const ritual = read("src/lib/ritual.ts");
  assert.equal(ritual.includes("export async function carryOverUniversalSalvationEntries"), true);
  const fn = ritual.slice(ritual.indexOf("export async function carryOverUniversalSalvationEntries"), ritual.indexOf("export async function carryOverUniversalSalvationEntries") + 1800);
  assert.equal(fn.includes("tabletAddress: e.tabletAddress"), true, "每筆保留自己的 tabletAddress");
  assert.equal(/amountPaid|printedAt|printCount|feeStatus|paymentAmount/i.test(fn), false, "不複製付款/列印");
  // createUniversalSalvationEntry 新建為 DRAFT 由既有流程處理；價格由 ensureLinkedTabletItem 依新年度重算。
  const reg = read("src/lib/registrationItemRegistration.ts");
  assert.equal(reg.includes("carryOverHouseholdRegistration"), true);
  const cf = reg.slice(reg.indexOf("export async function carryOverHouseholdRegistration"), reg.indexOf("export async function carryOverHouseholdRegistration") + 1600);
  assert.equal(/amountPaid|printedAt|printCount/i.test(cf), false, "item carry-over 不讀付款/列印");
  assert.equal(cf.includes("registerItemsBatch(entries"), true, "走既有 registerItemsBatch（新年度重算價）");
});

test("性別於列印：空白性別一律不產生建生/瑞生（普渡小人頭＋年度燈皆是）", () => {
  // 小人頭（祭改）：走共用 formatJishi（UNKNOWN→null）。
  const pur = read("src/lib/purification.ts");
  assert.equal(pur.includes("formatJishi"), true, "小人頭列印用 formatJishi");
  const cn = read("src/lib/chineseNumerals.ts");
  assert.equal(/if \(gender === "MALE"\) return "吉時建生";\s*\n\s*if \(gender === "FEMALE"\) return "吉時瑞生";\s*\n\s*return null;/.test(cn), true, "formatJishi UNKNOWN→null");
  // 年度燈列印 profile：MALE→建生、FEMALE→瑞生、其餘 null（並列入待確認，不自行產生）。
  const zs = read("src/lib/zodiacSexagenary.ts");
  assert.equal(zs.includes('const jishi = genderNorm === "MALE" ? "建生" : genderNorm === "FEMALE" ? "瑞生" : null;'), true, "年度燈空白性別→jishi null");
  assert.equal(zs.includes("性別未填寫，無法決定建生／瑞生"), true, "空白性別列入待確認，不自行產生");
});

// ── 5. 性別匯入不補值、不猜測 ─────────────────────────────────
test("性別匯入：個人 Excel 性別無法辨識時不猜測（回 null＋記錯誤，不補男/女）", () => {
  const person = read("src/lib/devoteeImportPersonSheet.ts");
  assert.equal(person.includes("normalizeGenderInput"), true, "用共用性別正規化");
  // 無法辨識→errors，不猜測。
  assert.equal(/if \(result\.ok\) return result\.value;[\s\S]*errors\.push/.test(person), true, "不可辨識記錯誤、回 null");
});

// ── 3. 全家燈地址確認 ─────────────────────────────────────────
test("全家燈報名顯示家戶地址（摘要區，共用一個地址）；缺地址可草稿並警告", () => {
  const picker = read("src/components/lantern/AnnualLanternHouseholdPicker.tsx");
  // V15R5.3：地址移入家戶摘要區、全戶共用一個地址（不逐列重複）。
  assert.equal(picker.includes("家戶地址："), true, "摘要顯示家戶地址");
  assert.equal(picker.includes("householdAddress"), true);
  assert.equal(picker.includes("缺地址（草稿可存，確認／列印前需補）"), true, "缺地址可草稿並警告");
});
