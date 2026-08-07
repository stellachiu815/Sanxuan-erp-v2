import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V38 現場快速報名（沙盒可執行的靜態守則）。
 * DB 整合（實際建家戶／牌位／確認）於 Mac/staging 用測試活動執行。
 *
 * 這裡守住幾條容易回歸的關鍵規則：
 *  1. 報名成員自動帶報名人（registerActivity memberIds:[memberId]）。
 *  2. 陽上人是自由文字（不要求既有成員）——直接用 input 的 yangshangNames。
 *  3. 冤親地址＝報名人個人地址（registrantAddress）且連結報名人成員。
 *  4. 祖先／乙位正魂用各自安奉地（tabletAddress）。
 *  5. 重用既有零件，不另建第二套報名系統。
 */
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("quickRegistration：重用既有零件（不建第二套）", () => {
  const src = read("src/lib/quickRegistration.ts");
  for (const fn of [
    "createHousehold",
    "createMemberForHousehold",
    "registerActivity",
    "createUniversalSalvationEntry",
    "registerRice",
    "syncSponsorItemInTx",
    "confirmRegistration",
  ]) {
    assert.ok(src.includes(fn), `應重用既有函式 ${fn}`);
  }
});

test("quickRegistration：報名成員自動帶報名人", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.match(src, /registerActivity\(\{[\s\S]*memberIds:\s*\[memberId\]/, "registerActivity 應帶 memberIds:[memberId]");
});

test("quickRegistration：冤親＝報名人個人地址＋連結報名人", () => {
  const src = read("src/lib/quickRegistration.ts");
  const creditor = src.slice(src.indexOf('category: "DEBT_CREDITOR"'), src.indexOf('category: "DEBT_CREDITOR"') + 400);
  assert.ok(creditor.includes("tabletAddress: registrantAddress"), "冤親地址應為 registrantAddress");
  assert.ok(creditor.includes("linkedItemMemberId: memberId"), "冤親應連結報名人成員");
  assert.ok(creditor.includes('displayName: "累世冤親債主"'), "冤親主文固定");
});

test("quickRegistration：祖先／乙位正魂用各自安奉地", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.ok(src.includes('category: "ANCESTOR_LINE"'), "應有歷代祖先");
  assert.ok(src.includes('category: "INDIVIDUAL_SOUL"'), "應有乙位正魂");
  // 兩者都以該筆 tabletAddress（安奉地）建立
  assert.match(src, /category: "ANCESTOR_LINE"[\s\S]*tabletAddress: s\(a\.tabletAddress\)/);
  assert.match(src, /category: "INDIVIDUAL_SOUL"[\s\S]*tabletAddress: s\(soul\.tabletAddress\)/);
});

test("quickRegistration：陽上人自由文字（不要求既有成員）", () => {
  const src = read("src/lib/quickRegistration.ts");
  // defaultYang 由 input 的 yangshangNames 正規化而來，留空才退回報名人姓名
  assert.ok(src.includes("normalizeYangshangNames"), "陽上人應經正規化，非查成員");
  assert.ok(src.includes("registrantName ? [registrantName] : []"), "留空時退回報名人姓名");
});

test("quickRegistration：選既有信眾時，報名人姓名＝該成員姓名（陽上人不會變空）", () => {
  const src = read("src/lib/quickRegistration.ts");
  // 選既有信眾時 registrant.name 不會送，必須用成員姓名補上，否則冤親／無緣陽上人變空白。
  assert.ok(src.includes("if (!registrantName) registrantName = m.name;"), "既有信眾要用成員姓名補 registrantName");
  // 不得再有「以 input.name 覆寫」的重複宣告。
  assert.ok(!src.includes("const registrantName = s(input.registrant.name);"), "不應保留舊的 const 覆寫宣告");
});

test("quick-registration API：POST 與 GET 皆有權限檢查", () => {
  const src = read("src/app/api/quick-registration/route.ts");
  const checks = src.match(/assertUniversalSalvationPermissionForOperator/g) ?? [];
  assert.ok(checks.length >= 2, "GET 與 POST 都要有權限檢查");
});

test("冤親／無緣地址：createUniversalSalvationEntry 會自動帶入（不再空白）", () => {
  const src = read("src/lib/ritual.ts");
  // 兩類都納入自動帶入集合
  assert.match(src, /AUTO_ADDRESS_CATS = new Set\(\["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"\]\)/);
  // 冤親／無緣以陽上人姓名在本戶找有地址的成員帶入
  assert.match(src, /input\.category === "DEBT_CREDITOR" \|\| input\.category === "UNBORN_CHILD"/);
  assert.match(src, /name: yName, deletedAt: null, address: \{ not: null \}/);
  // linked member 的 select 有帶 address（修正舊版永遠 undefined 的漏洞）
  assert.match(src, /select: \{ id: true, householdId: true, address: true \}/);
});

test("回填工具：冤親／無緣空白地址（陽上人個人地址→家戶地址）", () => {
  const src = read("src/lib/backfillCreditorUnbornAddress.ts");
  assert.ok(src.includes('category: { in: ["DEBT_CREDITOR", "UNBORN_CHILD"] }'), "只處理冤親／無緣");
  assert.ok(src.includes("!norm(e.tabletAddress)"), "只補目前空白者");
  const route = read("src/app/api/admin/universal-salvation/maintenance/route.ts");
  assert.ok(route.includes('"backfill-creditor-unborn-address"'), "維護 API 有掛這個動作");
});

test("冤親／無緣重複牌位清理：走安全流程 removeRegisteredItem", () => {
  const src = read("src/lib/dedupCreditorUnbornTablets.ts");
  assert.ok(src.includes("removeRegisteredItem"), "用既有安全流程取消（含軟刪牌位、擋已收款／已列印）");
  assert.ok(src.includes('category: { in: ["DEBT_CREDITOR", "UNBORN_CHILD"] }'), "只清冤親／無緣");
});

test("收回已封存家戶的普渡報名：只收未收款未列印、軟刪可還原", () => {
  const src = read("src/lib/purgeArchivedHouseholdUsRecords.ts");
  assert.ok(src.includes("household: { deletedAt: { not: null } }"), "只找已封存家戶");
  assert.ok(src.includes("activityType: \"UNIVERSAL_SALVATION\""), "只收普渡報名");
  assert.ok(src.includes("Number(it.amountPaid) > 0"), "已收款要擋");
  assert.ok(src.includes("it.printCount > 0 || it.printedAt != null"), "已列印要擋");
  assert.ok(src.includes("deleteUniversalSalvationRecord"), "用軟刪（可還原）");
  const route = read("src/app/api/admin/universal-salvation/maintenance/route.ts");
  assert.ok(route.includes('"purge-archived-us-records"'), "維護 API 有掛這個動作");
  const arch = read("src/lib/archiveHouseholdsByCode.ts");
  assert.ok(arch.includes("purgeArchivedHouseholdUsRecords"), "封存家戶時會自動一起收（未來不再殘留）");
});

test("冤親／無緣空白陽上人回填：來源＝報名人（nameSnapshot），只補空白", () => {
  const src = read("src/lib/backfillCreditorUnbornYangshang.ts");
  assert.ok(src.includes('category: { in: ["DEBT_CREDITOR", "UNBORN_CHILD"] }'), "只處理冤親／無緣");
  assert.ok(src.includes("nameSnapshot"), "陽上人來源＝報名人 nameSnapshot");
  assert.ok(src.includes("yangshangNames: [c.newYangshang], yangshangName: c.newYangshang"), "同時寫陣列與單值");
  const route = read("src/app/api/admin/universal-salvation/maintenance/route.ts");
  assert.ok(route.includes('"backfill-creditor-unborn-yangshang"'), "維護 API 有掛這個動作");
});

test("列印排除已封存家戶（雙保險）", () => {
  const src = read("src/lib/additionalPrintItems.ts");
  assert.ok(src.includes("household: { deletedAt: null }"), "列印查詢排除已封存家戶");
});

test("#2 快速報名新家戶戶名＝{姓}家", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.ok(src.includes("`${surname}家`"), "戶名用姓+家");
  assert.ok(src.includes("contactName: name"), "聯絡人仍存本人全名");
});

test("#3 匯出總名單：含 DRAFT、排除封存戶、照建立順序", () => {
  const src = read("src/lib/universalSalvationRosterExport.ts");
  assert.ok(!src.includes('status: "CONFIRMED"'), "不再限 CONFIRMED（含 DRAFT）");
  assert.ok(src.includes('status: { not: "CANCELLED" }'), "只排除已取消");
  assert.ok(src.includes("household: { deletedAt: null }"), "排除已封存家戶");
  assert.ok(src.includes('orderBy: { createdAt: "asc" }'), "照建立順序＝匯入在前、ERP 往後");
});

test("#3b 匯出總名單工作表照列印批次歸類（表一祖先/正魂/地基主、表二冤親/無緣）", () => {
  const src = read("src/lib/universalSalvationRosterExport.ts");
  // 表一含地基主（US_WUYUAN 含「地基主」主文分流進表一）。
  assert.ok(src.includes('r.key === "US_WUYUAN" && isEarthGod(r)'), "地基主歸入祖先/正魂表");
  // 表二含無緣子女（非地基主的 US_WUYUAN）。
  assert.ok(src.includes('r.key === "US_WUYUAN" && !isEarthGod(r)'), "無緣子女歸入冤親表");
  assert.ok(src.includes("creditorUnborn"), "有冤親+無緣合併表");
  const route = read("src/app/api/universal-salvation/[year]/roster-export/route.ts");
  assert.ok(route.includes('"祖先+乙位正魂+地基主"'), "分頁一：祖先/正魂/地基主");
  assert.ok(route.includes('"累世冤親債主+無緣子女"'), "分頁二：冤親/無緣");
});

test("#4 作業編號照列印批次合併（祖先組／冤親組，地基主分流）", () => {
  const repo = read("src/lib/workOrderRepo.ts");
  assert.ok(repo.includes("listWorkOrderRowsForBatch"), "有批次查詢");
  assert.ok(repo.includes('"ancestor-soul": ["US_ANCESTOR", "US_ZHENGHUN", "US_WUYUAN"]'), "祖先組含祖先/正魂/無緣(地基主)");
  assert.ok(repo.includes('creditor: ["US_YUANQIN", "US_WUYUAN"]'), "冤親組含冤親/無緣");
  assert.ok(repo.includes('main.includes("地基主")'), "US_WUYUAN 依主文分流");
  assert.ok(repo.includes("itemKey: batchKey"), "整批視為同一條序列（一起編 1..N）");
  const page = read("src/app/print-center/work-orders/page.tsx");
  assert.ok(page.includes('setBatch(e.target.value as "ancestor-soul" | "creditor")'), "管理頁改用批次下拉");
});

test("#1 列印字體：三欄陽上人讓寬給地址（修地址過小）", () => {
  const src = read("src/components/ritual/tablets/landscapeLayout.ts");
  assert.ok(src.includes("const YANG_REMAIN_RATIO = 0.33"), "陽上人 0.42→0.33，地址欄變寬");
});

test("贊普／大額贊普認購人名稱：留空＝報名人", () => {
  const src = read("src/lib/quickRegistration.ts");
  assert.ok(src.includes("s(input.sponsorName) ?? registrantName"), "贊普認購人可填公司名，空＝報名人");
  assert.ok(src.includes("s(input.donationName) ?? registrantName"), "大額贊普認購人可填公司名，空＝報名人");
});

test("信眾公開報名：免登入頁、送出只進待確認、確認即轉正式", () => {
  const mw = read("src/middleware.ts");
  assert.ok(mw.includes('pathname.startsWith("/join/")'), "/join/ 免登入");
  const lib = read("src/lib/publicReg.ts");
  assert.ok(lib.includes("'PENDING'") || lib.includes('"PENDING"') || lib.includes("PENDING"), "送出進待確認");
  assert.ok(lib.includes("quickRegister(input"), "確認時重用 quickRegister 轉正式");
  assert.ok(lib.includes("confirm: true"), "確認即轉正式");
  assert.ok(lib.includes("INTERVAL '30 seconds'"), "有防重複送出");
  const route = read("src/app/api/public-reg/[slug]/submit/route.ts");
  assert.ok(!/assert[A-Za-z]*Permission/.test(route), "公開送出端點刻意免登入");
});

test("建普渡活動時自動產生公開報名表", () => {
  const src = read("src/lib/templeEvents.ts");
  assert.ok(src.includes("upsertPublicRegForm"), "建活動時自動產生報名表");
  assert.ok(src.includes("普渡${input.year}"), "預設 slug 普渡{年}");
});

test("報名就是報名：確認驗證認得新式贊普/白米/寶袋（不卡草稿）", () => {
  const src = read("src/lib/activityRegistration.ts");
  assert.ok(src.includes("US_SPONSOR") && src.includes("US_RICE") && src.includes("US_POCKET_EXTRA"), "確認驗證計入新式項目");
  assert.ok(src.includes("hasUsItem"), "有任一有效項目即可確認");
});

test("白米：匯入報名開啟時自動補年度活動連結", () => {
  const src = read("src/lib/activityRegistration.ts");
  assert.ok(src.includes("!record.templeEventId") && src.includes("templeEventId: event.id"), "既有報名缺 templeEventId 時補上");
});

test("新增活動報名支援新信眾：查無此人當場建（姓家），走報名權限", () => {
  const src = read("src/app/api/registrations/new-person/route.ts");
  assert.ok(src.includes("assertRitualRegistrationPermissionForOperator"), "用報名權限");
  assert.ok(src.includes("`${surname}家`"), "戶名姓家");
  const page = read("src/app/registration/new/page.tsx");
  assert.ok(page.includes("NewActivityRegistrationDialog"), "接既有豐富版報名對話框（不重做）");
  assert.ok(page.includes("/api/registrations/new-person"), "查無此人可當場建");
});

test("現場快速報名：打字即時查既有信眾（不用按鈕）", () => {
  const src = read("src/app/quick-registration/page.tsx");
  assert.ok(src.includes("useEffect(() => {\n    if (existing) return;"), "打字即時查（debounce useEffect）");
  assert.ok(!src.includes(">查既有信眾<"), "移除手動查詢按鈕");
});

test("數量欄可直接輸入（不再只能按上下鍵）", () => {
  const src = read("src/components/devotee/NewActivityRegistrationDialog.tsx");
  assert.ok(src.includes('value={s.quantity === 0 ? "" : s.quantity}'), "可清空重打");
  assert.ok(src.includes("onBlur={() => { if (!s.quantity"), "離開時補回至少 1");
});

test("公開報名 raw INSERT 明確帶 updatedAt（避免 23502 NOT NULL）", () => {
  const src = read("src/lib/publicReg.ts");
  assert.ok(src.includes('"createdAt","updatedAt") VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'), "form INSERT 帶 updatedAt");
  assert.ok(src.includes('"submitterHash","createdAt","updatedAt") VALUES ($1,$2,\'PENDING\',$3::jsonb,$4,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)'), "registration INSERT 帶 updatedAt");
});

test("現場快速報名防呆：與剛送出相同內容先確認", () => {
  const src = read("src/app/quick-registration/page.tsx");
  assert.ok(src.includes("sig === lastSig"), "相同內容比對");
  assert.ok(src.includes("確定要再報一筆嗎"), "重複時跳確認");
  assert.ok(src.includes("setLastSig(sig)"), "成功後記住這次的內容");
});

test("現場快速報名自動帶入當下活動（不用選）", () => {
  const src = read("src/app/quick-registration/page.tsx");
  assert.ok(src.includes("自動帶入目前辦理的活動"), "自動帶入當下活動、顯示唯讀");
});

test("乙位正魂一鍵轉歷代祖先（永久牌位＋本年度報名皆可）", () => {
  const src = read("src/lib/auditIndividualSoulNames.ts");
  assert.ok(src.includes("convertSoulToAncestor"), "有轉換函式");
  assert.ok(src.includes('type: "ANCESTOR_LINE"'), "永久牌位改 type");
  assert.ok(src.includes('category: "ANCESTOR_LINE"'), "報名牌位改 category");
  assert.ok(src.includes('key: "US_ANCESTOR"'), "連動計價項目改成歷代祖先");
  const route = read("src/app/api/admin/universal-salvation/maintenance/route.ts");
  assert.ok(route.includes('"convert-soul-to-ancestor"'), "維護 API 有掛轉換動作");
});

test("作業編號『移到第 N 號』＝插入語意（其餘順延、連號重編）", async () => {
  const { moveToPosition } = await import("../src/lib/workOrder");
  const rows = ["a", "b", "c", "d", "e"].map((id, i) => ({ id, categoryKey: "K", workOrder: i + 1 }));
  // 把最後一筆 e（第 5 號）移到第 2 號。
  const out = moveToPosition(rows, "e", 2);
  const byId = new Map(out.map((o) => [o.id, o.workOrder]));
  assert.equal(byId.get("a"), 1, "a 維持 1");
  assert.equal(byId.get("e"), 2, "e 變成 2");
  assert.equal(byId.get("b"), 3, "原本 2（b）順延成 3");
  assert.equal(byId.get("c"), 4, "原本 3（c）順延成 4");
  assert.equal(byId.get("d"), 5, "原本 4（d）順延成 5");
  // 全體連號 1..N、不重複。
  assert.deepEqual([...byId.values()].sort((x, y) => x - y), [1, 2, 3, 4, 5]);
});
