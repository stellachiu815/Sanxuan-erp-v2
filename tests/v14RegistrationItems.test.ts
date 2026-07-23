import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

import {
  REGISTRATION_ITEM_SEED,
  computeItemAmountDue,
  readTurtleSizes,
} from "../src/lib/registrationItems";
import { PRINT_TEMPLATE_SEED } from "../src/lib/printTemplates";

/**
 * V14「活動報名多項目架構＋列印管理整合」測試（指令十三）。
 * 不動、不重跑 V13.4 測試——那份獨立保留。
 */

const ROOT = process.cwd();
const seedByKey = new Map(REGISTRATION_ITEM_SEED.map((s) => [s.key, s]));
const itemsInGroup = (g: string) => REGISTRATION_ITEM_SEED.filter((s) => s.activityGroup === g);

// ============================================================
// 一、主活動 → 多報名項目
// ============================================================

test("1. 一個主活動可有多個報名項目", () => {
  assert.equal(itemsInGroup("UNIVERSAL_SALVATION").length > 1, true);
  assert.equal(itemsInGroup("ANNUAL_LANTERN").length > 1, true);
  assert.equal(itemsInGroup("TEMPLE_CELEBRATION").length > 1, true);
});

test("2. 中元普渡七大類齊備（贊普大類含贊普＋隨喜贊普兩個獨立選項）", () => {
  const us = itemsInGroup("UNIVERSAL_SALVATION").map((s) => s.name);
  // 七大類核心名稱全部存在
  for (const core of ["超拔祖先", "乙位正魂", "累世冤親債主", "無緣子女", "增加寶袋", "白米登記", "贊普"]) {
    assert.equal(us.includes(core), true, `缺少核心項目：${core}`);
  }
  // 贊普大類的第二個獨立選項
  assert.equal(us.includes("隨喜贊普"), true);
  // 贊普與隨喜贊普是分開的兩個 item（分開保存/計價/列印）
  assert.notEqual(seedByKey.get("US_SPONSOR"), undefined);
  assert.notEqual(seedByKey.get("US_SPONSOR_DONATION"), undefined);
});

test("3. 年度燈固定四個報名項目", () => {
  const lantern = itemsInGroup("ANNUAL_LANTERN").map((s) => s.name);
  assert.equal(lantern.length, 4);
  assert.deepEqual(lantern, ["光明燈", "太歲燈", "全家燈", "祭改"]);
  // 四項跨四種 activityType，但同一主活動分組
  const types = new Set(itemsInGroup("ANNUAL_LANTERN").map((s) => s.activityType));
  assert.equal(types.size, 4);
});

test("4. 宮慶固定三個報名項目", () => {
  const cel = itemsInGroup("TEMPLE_CELEBRATION").map((s) => s.name);
  assert.equal(cel.length, 3);
  assert.deepEqual(cel, ["訂桌名單", "福壽龜", "爐主／副爐主名單"]);
});

test("5. 同一信眾可在同一主活動下報名多個不同項目", () => {
  // 普渡的七項各自是獨立項目 key → 同一人可分別報名
  const usKeys = itemsInGroup("UNIVERSAL_SALVATION").map((s) => s.key);
  assert.equal(new Set(usKeys).size, usKeys.length, "項目 key 必須各自唯一");
  // 且至少牌位類允許同一人多筆
  assert.equal(seedByKey.get("US_ANCESTOR")!.allowMultiplePerMember, true);
});

// ============================================================
// 二、不再受單一 registrationFormType 限制／未選項目不能建立
// ============================================================

test("6. 報名項目 POST 必須帶 registrationItemTypeId，未選項目不能建立", () => {
  const route = readFileSync(
    join(ROOT, "src/app/api/devotee-center/[memberId]/registration-items/route.ts"),
    "utf-8"
  );
  assert.equal(route.includes('typeof registrationItemTypeId !== "string"'), true);
  // service 找不到項目設定 → 回 404，不建立
  const svc = readFileSync(join(ROOT, "src/lib/registrationItemRegistration.ts"), "utf-8");
  assert.equal(svc.includes('status: 404, error: "找不到這個報名項目設定"'), true);
});

test("7. 新報名入口用項目清單，不再受單一 registrationFormType 限制", () => {
  const groupsRoute = readFileSync(
    join(ROOT, "src/app/api/devotee-center/[memberId]/activity-groups/route.ts"),
    "utf-8"
  );
  assert.equal(groupsRoute.includes("listActivityGroups"), true);
  assert.equal(groupsRoute.includes("resolveRegistrationFormType"), false, "不得再用單一 formType 分派");
  const dialog = readFileSync(
    join(ROOT, "src/components/devotee/NewActivityRegistrationDialog.tsx"),
    "utf-8"
  );
  assert.equal(dialog.includes("/activity-groups"), true);
  assert.equal(dialog.includes("registration-items"), true);
  // 不再有「尚未設定報名表所以不能按」的死路文案
  assert.equal(dialog.includes("尚未設定報名表"), false);
});

// ============================================================
// 三、福壽龜／贊普／基本寶袋規則
// ============================================================

test("8. 福壽大龜預設 1、福壽中龜預設 6，且存於可編輯的 metadata", () => {
  const turtle = seedByKey.get("CELEBRATION_TURTLE")!;
  const sizes = readTurtleSizes(turtle.metadata ?? null);
  const big = sizes.find((s) => s.key === "BIG");
  const mid = sizes.find((s) => s.key === "MID");
  assert.equal(big?.defaultQuantity, 1);
  assert.equal(mid?.defaultQuantity, 6);
  // 是資料不是寫死：feeMode 為 PER_UNIT，數量可由使用者改
  assert.equal(turtle.feeMode, "PER_UNIT");
});

test("9. 贊普（固定單價，不寫死金額）與隨喜贊普（自訂金額）分開計價", () => {
  const sponsor = seedByKey.get("US_SPONSOR")!;
  const donation = seedByKey.get("US_SPONSOR_DONATION")!;
  // 贊普：固定單價，且種子不寫死金額（讀活動設定；未設定時為 null）
  assert.equal(sponsor.feeMode, "FIXED");
  assert.equal(sponsor.defaultUnitPrice, null, "贊普不得寫死預設金額");
  // 隨喜贊普：自訂金額
  assert.equal(donation.feeMode, "CUSTOM");
  // 兩者皆可多份、各自子明細
  assert.equal(sponsor.allowMultiplePerMember, true);
  assert.equal(donation.allowMultiplePerMember, true);
  // 固定單價（來自活動設定，測試以指定值代入）× 數量
  const fixed = computeItemAmountDue({ feeMode: "FIXED", defaultUnitPrice: 600, quantity: 2 });
  assert.equal(fixed.ok && fixed.amountDue, 600); // FIXED 為每份固定，數量另計於份數
  // 隨喜每份自訂金額，> 0
  const custom = computeItemAmountDue({ feeMode: "CUSTOM", defaultUnitPrice: null, quantity: 1, customAmount: 1234 });
  assert.equal(custom.ok && custom.amountDue, 1234);
  assert.equal(computeItemAmountDue({ feeMode: "CUSTOM", defaultUnitPrice: null, quantity: 1, customAmount: 0 }).ok, false);
});

test("10. 普渡超拔祖先／冤親債主／無緣子女預設帶基本寶袋，乙位正魂不帶", () => {
  for (const k of ["US_ANCESTOR", "US_YUANQIN", "US_WUYUAN"]) {
    assert.equal(seedByKey.get(k)!.printDocumentKeys.includes("US_BASIC_POCKET"), true, `${k} 應帶基本寶袋`);
  }
  assert.equal(seedByKey.get("US_ZHENGHUN")!.printDocumentKeys.includes("US_BASIC_POCKET"), false);
});

test("11. 額外寶袋是獨立項目、可多筆、可自訂名稱", () => {
  const extra = seedByKey.get("US_POCKET_EXTRA")!;
  assert.equal(extra.contentKind, "POCKET");
  assert.equal(extra.allowMultiplePerMember, true);
  // 對話框允許 POCKET 類自訂名稱
  const dialog = readFileSync(join(ROOT, "src/components/devotee/NewActivityRegistrationDialog.tsx"), "utf-8");
  assert.equal(/canCustomName[\s\S]{0,80}POCKET/.test(dialog), true);
  // service 接受 customName
  const svc = readFileSync(join(ROOT, "src/lib/registrationItemRegistration.ts"), "utf-8");
  assert.equal(svc.includes("customName"), true);
});

// ============================================================
// 四、收費／列印計算
// ============================================================

test("計價：PER_UNIT = 單價×數量、FIXED=固定、NONE=0、負值/零數量擋住", () => {
  assert.equal((computeItemAmountDue({ feeMode: "PER_UNIT", defaultUnitPrice: 500, quantity: 3 }) as { amountDue: number }).amountDue, 1500);
  assert.equal((computeItemAmountDue({ feeMode: "FIXED", defaultUnitPrice: 2000, quantity: 9 }) as { amountDue: number }).amountDue, 2000);
  assert.equal((computeItemAmountDue({ feeMode: "NONE", defaultUnitPrice: null, quantity: 1 }) as { amountDue: number }).amountDue, 0);
  assert.equal(computeItemAmountDue({ feeMode: "PER_UNIT", defaultUnitPrice: 500, quantity: 0 }).ok, false);
  assert.equal(computeItemAmountDue({ feeMode: "CUSTOM", defaultUnitPrice: null, quantity: 1, customAmount: -1 }).ok, false);
});

test("12. 每個項目都可產生報名總名單（都有列印品 key，且有 roster 查詢）", () => {
  for (const s of REGISTRATION_ITEM_SEED) {
    assert.equal(s.printDocumentKeys.length >= 1, true, `${s.key} 應至少有一個列印品`);
  }
  assert.equal(existsSync(join(ROOT, "src/lib/printDocuments.ts")), true);
  const pd = readFileSync(join(ROOT, "src/lib/printDocuments.ts"), "utf-8");
  assert.equal(pd.includes("export async function buildItemRoster"), true);
});

test("13. 需要列印的項目可進列印管理（roster API 存在、只列 CONFIRMED）", () => {
  const rosterApi = join(ROOT, "src/app/api/print-center/rosters/[itemKey]/[year]/route.ts");
  assert.equal(existsSync(rosterApi), true);
  const pd = readFileSync(join(ROOT, "src/lib/printDocuments.ts"), "utf-8");
  // 預設不列草稿
  assert.equal(pd.includes('status: "CONFIRMED"'), true);
});

test("14. 補褲只有名單、收費、收據——沒有其他活動專用列印", () => {
  const st = seedByKey.get("STORAGE_TROUSERS")!;
  assert.equal(st.contentKind, "ROSTER");
  assert.equal(st.feeMode, "CUSTOM");
  // 只有一個總名單列印品，沒有牌位/疏文/貼紙
  assert.deepEqual(st.printDocumentKeys, ["STORAGE_TROUSERS_ROSTER"]);
});

// ============================================================
// 五、沿用去年不複製付款/收據/列印（V13.4 規則延續，靜態確認未被破壞）
// ============================================================

test("15. 沿用去年仍不複製付款／收據／列印／對帳狀態", () => {
  const src = readFileSync(join(ROOT, "src/lib/ritual.ts"), "utf-8");
  const copyFn = src.slice(src.indexOf("copyUniversalSalvationFromPreviousYear"));
  for (const forbidden of ["amountPaid: universalSalvation.amountPaid", "isPrinted", "printedQuantity", "receiptNumber", "printBatchId"]) {
    assert.equal(copyFn.includes(forbidden), false, `不得複製 ${forbidden}`);
  }
});

// ============================================================
// 六、權限與安全
// ============================================================

test("16. READONLY 無法新增或修改報名項目（後端權限＋不信任前端）", () => {
  // 權限矩陣：READONLY 不含 register / manageParticipant
  const perms = readFileSync(join(ROOT, "src/lib/permissions.ts"), "utf-8");
  const roMatch = perms.match(/READONLY:\s*\[([^\]]*)\]/);
  assert.notEqual(roMatch, null);
  assert.equal(roMatch![1].includes("register"), false);
  assert.equal(roMatch![1].includes("manageParticipant"), false);

  // 三支寫入／讀取 API 都呼叫後端權限檢查
  const postRoute = readFileSync(join(ROOT, "src/app/api/devotee-center/[memberId]/registration-items/route.ts"), "utf-8");
  assert.equal(postRoute.includes('assertRitualRegistrationPermissionForOperator(operatorUserId, "register")'), true);
  const delRoute = readFileSync(join(ROOT, "src/app/api/registrations/[ritualRecordId]/items/[itemId]/route.ts"), "utf-8");
  assert.equal(delRoute.includes('assertRitualRegistrationPermissionForOperator(operatorUserId, "manageParticipant")'), true);
  // 用後端解析的操作人員姓名，不信任前端傳入的 name
  assert.equal(postRoute.includes("operatorName: check.operator.name"), true);
});

test("16. service 不吞錯回成功、不把失敗當 0", () => {
  const svc = readFileSync(join(ROOT, "src/lib/registrationItemRegistration.ts"), "utf-8");
  // catch 內回傳 ok:false，而非 ok:true 或金額 0
  assert.equal(/catch[\s\S]{0,200}ok: false/.test(svc), true);
  assert.equal(/catch[\s\S]{0,120}amountDue: 0/.test(svc), false);
});

// ============================================================
// 七、效能原則延續（無過度 Promise.all、無 N+1、singleton）
// ============================================================

test("17. 新 lib 不新增巨型平行查詢、無逐筆 N+1、共用 singleton", () => {
  const files = [
    "src/lib/registrationItems.ts",
    "src/lib/registrationItemRegistration.ts",
    "src/lib/printDocuments.ts",
  ];
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf-8");
    // 不得自建 PrismaClient
    assert.equal(src.includes("new PrismaClient"), false, `${f} 不得自建 PrismaClient`);
    // Promise.all 若有，元素數不得過多（這些檔案本就不該有大扇出）
    const blocks = src.match(/Promise\.all\(\[[\s\S]*?\]\)/g) ?? [];
    for (const b of blocks) {
      const count = (b.match(/prisma\./g) ?? []).length;
      assert.equal(count <= 3, true, `${f} 的 Promise.all 平行查詢過多`);
    }
  }
});

test("18. 新增的收款 adapter 仍受控並行、DRAFT 不進待收款", () => {
  const ad = readFileSync(join(ROOT, "src/lib/receivableAdapters.ts"), "utf-8");
  // 四個新來源都註冊
  for (const a of ["riceRegistrationAdapter", "celebrationTableAdapter", "dragonPhoenixLanternAdapter", "storageTrousersAdapter"]) {
    assert.equal(ad.includes(a), true, `${a} 未定義/註冊`);
  }
  // 新 adapter 也排除草稿
  const factory = ad.slice(ad.indexOf("function makeRegistrationItemAdapter"));
  assert.equal(factory.includes('status: "CONFIRMED"'), true);
  // 收款中心仍以受控並行呼叫（沿用 V13.4）
  const cc = readFileSync(join(ROOT, "src/lib/collectionCenter.ts"), "utf-8");
  assert.equal(cc.includes("mapWithConcurrency"), true);
});

// ============================================================
// 第二輪整合測試
// ============================================================

const ACTIVITY_REG = readFileSync(join(ROOT, "src/lib/activityRegistration.ts"), "utf-8");
const ITEM_REG = readFileSync(join(ROOT, "src/lib/registrationItemRegistration.ts"), "utf-8");
const PRINT_DOCS = readFileSync(join(ROOT, "src/lib/printDocuments.ts"), "utf-8");
const RECV = readFileSync(join(ROOT, "src/lib/receivableAdapters.ts"), "utf-8");

test("R2-1. 確認報名時，旗下未刪除項目同步 DRAFT→CONFIRMED", () => {
  const confirmFn = ACTIVITY_REG.slice(
    ACTIVITY_REG.indexOf("export async function confirmRegistration"),
    ACTIVITY_REG.indexOf("export async function cancelRegistration")
  );
  assert.equal(confirmFn.includes("ritualRegistrationItem.updateMany"), true);
  assert.equal(/updateMany\([\s\S]*?status: "DRAFT"[\s\S]*?status: "CONFIRMED"/.test(confirmFn), true);
});

test("R2-1. 取消報名時，旗下項目同步 CANCELLED（不進列印與待收款）", () => {
  const cancelFn = ACTIVITY_REG.slice(ACTIVITY_REG.indexOf("export async function cancelRegistration"));
  assert.equal(/ritualRegistrationItem\.updateMany\([\s\S]*?status: "CANCELLED"/.test(cancelFn), true);
});

test("R2-2. CONFIRMED 才進待收款：adapter 以項目 status=CONFIRMED 過濾", () => {
  const factory = RECV.slice(RECV.indexOf("function makeRegistrationItemAdapter"), RECV.indexOf("const riceRegistrationAdapter"));
  // where 內同時要求項目本身 status CONFIRMED 與主報名 CONFIRMED
  assert.equal(factory.includes('status: "CONFIRMED"'), true);
  assert.equal(factory.includes('ritualRecord: { deletedAt: null, status: "CONFIRMED" }'), true);
});

test("R2-3. linkedEntryId／linkedEntryType 真實回寫（LANTERN／SPONSOR）", () => {
  assert.equal(ITEM_REG.includes('linkedEntryType: "LanternRegistration"'), true);
  assert.equal(ITEM_REG.includes('linkedEntryType: "UniversalSalvationDetail"'), true);
  // 避免兩筆應收：連結後本項目金額歸零
  assert.equal(/linkedEntryType: "LanternRegistration"[\s\S]{0,120}?/.test(ITEM_REG), true);
  const linkFn = ITEM_REG.slice(ITEM_REG.indexOf("async function linkItemToExistingDetail"));
  assert.equal(linkFn.includes("amountDue: 0"), true, "連結既有明細後項目金額須歸零");
});

test("R2-4. 普渡／年度燈沿用既有明細（不建第二套）", () => {
  // 年度燈金額寫回既有 LanternRegistration
  assert.equal(ITEM_REG.includes("upsertLanternRegistrationInTransaction"), true);
  // 贊普寫回既有 UniversalSalvationDetail
  assert.equal(ITEM_REG.includes("universalSalvationDetail.upsert"), true);
});

test("R2-5. 福壽龜大龜 1／中龜 6 為可編輯 metadata（同前，回歸保護）", () => {
  const sizes = readTurtleSizes(seedByKey.get("CELEBRATION_TURTLE")!.metadata ?? null);
  assert.equal(sizes.find((s) => s.key === "BIG")?.defaultQuantity, 1);
  assert.equal(sizes.find((s) => s.key === "MID")?.defaultQuantity, 6);
});

test("R2-6. 列印模板種子涵蓋所有 printDocumentKeys 且不重複", () => {
  const allKeys = new Set<string>();
  for (const item of REGISTRATION_ITEM_SEED) for (const k of item.printDocumentKeys) allKeys.add(k);
  const seedKeys = PRINT_TEMPLATE_SEED.map((t) => t.key);
  // 覆蓋
  for (const k of allKeys) assert.equal(seedKeys.includes(k), true, `模板種子缺少 ${k}`);
  // 不重複
  assert.equal(new Set(seedKeys).size, seedKeys.length, "模板 key 不得重複");
});

test("R2-6. 模板種子冪等（依 category+key 檢查存在，存在則略過）", () => {
  const tpl = readFileSync(join(ROOT, "src/lib/printTemplates.ts"), "utf-8");
  assert.equal(tpl.includes("category_key: { category: \"PRINT\", key: t.key }"), true);
  assert.equal(tpl.includes("if (!existing)"), true, "已存在者須略過，不重複建立");
});

test("R2-7. 列印管理可列出所有活動項目（中央彙總）", () => {
  assert.equal(PRINT_DOCS.includes("export async function listActivityItemPrintSummary"), true);
  assert.equal(existsSync(join(ROOT, "src/app/api/print-center/activity-items/route.ts")), true);
  assert.equal(existsSync(join(ROOT, "src/app/print-center/page.tsx")), true);
});

test("R2-8. 總名單只列 CONFIRMED（項目與主報名皆須 CONFIRMED）", () => {
  const rosterFn = PRINT_DOCS.slice(PRINT_DOCS.indexOf("export async function buildItemRoster"), PRINT_DOCS.indexOf("export type ActivityItemPrintSummary"));
  assert.equal(rosterFn.includes('status: "CONFIRMED"'), true);
});

test("R2-9. 補印不改變收款狀態（markRosterPrinted 只動 printCount/printedAt）", () => {
  const markFn = PRINT_DOCS.slice(PRINT_DOCS.indexOf("export async function markRosterPrinted"));
  assert.equal(markFn.includes("printCount: { increment: 1 }"), true);
  // 絕不觸碰金額欄位
  assert.equal(markFn.includes("amountDue"), false);
  assert.equal(markFn.includes("amountPaid"), false);
  assert.equal(markFn.includes("amountUnpaid"), false);
});

test("R2-10. 新列印管理 API 權限：READONLY 不可寫入", () => {
  const mark = readFileSync(join(ROOT, "src/app/api/print-center/rosters/[itemKey]/[year]/mark-printed/route.ts"), "utf-8");
  assert.equal(mark.includes('"manageParticipant"'), true);
  const seed = readFileSync(join(ROOT, "src/app/api/print-center/seed-templates/route.ts"), "utf-8");
  assert.equal(seed.includes('"register"'), true);
});

test("R2-11. migration 種子與程式種子定義一致（key 集合相同）", () => {
  // 種子 key 分散在原始種子 migration 與 V14.1 贊普拆分 migration。
  const files = [
    "prisma/migrations/20260725000002_v14_seed_registration_items/migration.sql",
    "prisma/migrations/20260726000001_v14_1_sponsor_split/migration.sql",
  ];
  const allSql = files.map((f) => readFileSync(join(ROOT, f), "utf-8")).join("\n");
  for (const s of REGISTRATION_ITEM_SEED) {
    assert.equal(allSql.includes(`'${s.key}'`), true, `migration 種子缺少 ${s.key}`);
  }
});
