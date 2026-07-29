import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateFloralOfferingSlots,
  formatFloralSlotDate,
  checkDuplicateClaimConflict,
  checkTurtleExclusiveConflict,
  computeOfferingQuota,
  computeAmountDue,
  derivePaymentStatus,
  isCrossYearUnpaid,
  assertReprintPreservesAmounts,
  sumPaymentLedger,
  round2,
  OFFERING_ACTIVITY_TYPES,
  OFFERING_EXCLUDED_ACTIVITY_TYPES,
  isOfferingActivityType,
  isExcludedFromOffering,
  getOfferingTemplate,
  OFFERING_ACTIVITY_TEMPLATES,
} from "../src/lib/offeringRules";
import { readFileSync } from "node:fs";
import { join } from "node:path";
const readSrc = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

// 以下測試對應 V10.1 需求「二十二、自動測試」條列的 25 個案例（在檔案裡以
// 「案例 N」註明對應編號）。跟 DB 有關、無法脫離 Prisma 執行的整合行為
// （案例 1/2/3/5/13/15/20/21/22/23/25 牽涉真正的資料庫關聯查詢、供品種類
// 預設 seed 資料、前端畫面或權限矩陣）在 src/lib/offeringTypes.ts、
// src/lib/activityOfferings.ts、src/lib/offeringClaims.ts、
// src/lib/permissions.ts 裡用程式碼保證，這裡只測試可以脫離資料庫獨立
// 驗證的純規則部分（比照 V9.0/V9.1 既有測試檔案的切分慣例）。

test("案例11：花果供品自動建立 24 筆（12 個月 × 一日/十五日）", () => {
  const slots = generateFloralOfferingSlots();
  assert.equal(slots.length, 24);
  assert.equal(slots[0].lunarMonth, 1);
  assert.equal(slots[0].lunarDay, 1);
  assert.equal(slots[23].lunarMonth, 12);
  assert.equal(slots[23].lunarDay, 15);
  // 每個月都恰好有「一日」跟「十五日」各一筆
  for (let m = 1; m <= 12; m++) {
    const days = slots.filter((s) => s.lunarMonth === m).map((s) => s.lunarDay);
    assert.deepEqual(days, [1, 15]);
  }
});

test("案例12：花果供品日期格式為「一月一日／一月十五日」，不是「正月初一」「初一」「十五」", () => {
  assert.equal(formatFloralSlotDate(1, 1), "一月一日");
  assert.equal(formatFloralSlotDate(1, 15), "一月十五日");
  assert.equal(formatFloralSlotDate(12, 1), "十二月一日");
  assert.equal(formatFloralSlotDate(12, 15), "十二月十五日");
  for (const s of generateFloralOfferingSlots()) {
    const text = formatFloralSlotDate(s.lunarMonth, s.lunarDay);
    assert.ok(!text.includes("初"), `不應包含「初」：${text}`);
    assert.ok(!text.includes("正月"), `不應顯示「正月」：${text}`);
  }
});

test("案例4：同一信眾不可同時取得大福壽龜與小福壽龜（跨供品種類互斥，合併計算）", () => {
  const result = checkTurtleExclusiveConflict("TURTLE", true);
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /只能取得一隻福壽龜/);
});

test("2026-07-16 驗收修正：跨供品互斥是三玄宮固定規則，一律強制套用，函式已不接受可關閉的開關參數", () => {
  // 這支函式現在只有兩個參數（newClaimBehaviorKind／是否已有其他壽龜類認捐），
  // 沒有「是否啟用互斥規則」的開關——不存在可以讓這條規則被關閉的呼叫方式。
  const result = checkTurtleExclusiveConflict("TURTLE", true);
  assert.equal(result.allowed, false);
  assert.equal(checkTurtleExclusiveConflict.length, 2);
});

test("跨供品互斥規則只影響壽龜類供品，不影響其他供品種類", () => {
  const result = checkTurtleExclusiveConflict("NOODLE_TOWER", true);
  assert.equal(result.allowed, true);
});

test("大福壽龜：一人只能認捐 1 隻，重複登錄會被擋下", () => {
  const result = checkDuplicateClaimConflict(false, "大福壽龜", true);
  assert.equal(result.allowed, false);
  assert.match(result.reason ?? "", /大福壽龜/);
});

test("小福壽龜：同一信眾不可同時登錄兩隻小福壽龜", () => {
  const result = checkDuplicateClaimConflict(false, "小福壽龜", true);
  assert.equal(result.allowed, false);
});

test("offeringType.allowDuplicateClaim=true 時允許重複認捐（例如花果供品可能開放同一人認多個日期）", () => {
  const result = checkDuplicateClaimConflict(true, "花果供品", true);
  assert.equal(result.allowed, true);
});

test("案例8/9：壽桃麵塔數量可依活動調整（宮慶3對、神明聖誕1對），不寫死", () => {
  const templeCelebration = computeOfferingQuota(3, [1, 1], "INDIVIDUAL");
  assert.deepEqual(templeCelebration, { expected: 3, claimed: 2, remaining: 1 });

  const deityBirthday = computeOfferingQuota(1, [], "INDIVIDUAL");
  assert.deepEqual(deityBirthday, { expected: 1, claimed: 0, remaining: 1 });
});

test("案例10：散壽桃麵預設5小盤，但可修改；INDIVIDUAL 模式每盤分開計算尚缺數量", () => {
  const quota = computeOfferingQuota(5, [1, 1, 1], "INDIVIDUAL");
  assert.deepEqual(quota, { expected: 5, claimed: 3, remaining: 2 });

  const modifiedQuantity = computeOfferingQuota(8, [1, 1, 1], "INDIVIDUAL");
  assert.equal(modifiedQuantity.remaining, 5);
});

test("散壽桃麵 GROUPED 模式：5盤合為一組，整組只算 1 份，不會用加總的份數計算尚缺", () => {
  const notYetClaimed = computeOfferingQuota(5, [], "GROUPED");
  assert.deepEqual(notYetClaimed, { expected: 1, claimed: 0, remaining: 1 });

  const claimed = computeOfferingQuota(5, [5], "GROUPED");
  assert.deepEqual(claimed, { expected: 1, claimed: 1, remaining: 0 });
});

test("案例18：取消未收款資料可釋出名額（從有效認捐清單移除後，尚缺數量回升）", () => {
  const beforeCancel = computeOfferingQuota(6, [1, 1, 1, 1, 1, 1], "INDIVIDUAL");
  assert.equal(beforeCancel.remaining, 0);
  // 取消其中一筆後，該筆不再列入 activeClaimQuantities
  const afterCancel = computeOfferingQuota(6, [1, 1, 1, 1, 1], "INDIVIDUAL");
  assert.equal(afterCancel.remaining, 1);
});

test("案例14：花果供品預設價格 1,500 元，但可修改", () => {
  assert.equal(computeAmountDue(1, 1500, true), 1500);
  assert.equal(computeAmountDue(1, 2000, true), 2000); // 管理者修改後的金額
});

test("免收（isChargeable=false）時應收金額固定為 0，不是 null，避免畫面顯示 NaN", () => {
  assert.equal(computeAmountDue(1, 1500, false), 0);
});

test("案例16：分次付款狀態正確——未收/部分/已收清", () => {
  assert.equal(derivePaymentStatus(1500, 0, false), "UNPAID");
  assert.equal(derivePaymentStatus(1500, 800, false), "PARTIAL");
  assert.equal(derivePaymentStatus(1500, 1500, false), "PAID");
  assert.equal(derivePaymentStatus(1500, 2000, false), "PAID"); // 溢收仍視為已收清，不會顯示超額未收
});

test("設定免收時，收款狀態固定為 WAIVED，不受金額影響", () => {
  assert.equal(derivePaymentStatus(1500, 0, true), "WAIVED");
});

test("不收費供品（amountDue=0）視為已收清", () => {
  assert.equal(derivePaymentStatus(0, 0, false), "PAID");
});

test("案例6/7：福壽龜可延後至下一年度付款，跨年度未收款仍可追蹤", () => {
  assert.equal(isCrossYearUnpaid(115, 115, "UNPAID"), false); // 當年度未收款，不算跨年度
  assert.equal(isCrossYearUnpaid(114, 115, "UNPAID"), true); // 去年認捐、今年還沒收，算跨年度
  assert.equal(isCrossYearUnpaid(114, 115, "PARTIAL"), true);
  assert.equal(isCrossYearUnpaid(114, 115, "PAID"), false); // 已收清就不算未收款
});

test("案例17：補印不增加收入，前後金額必須完全相同", () => {
  const before = { amountDue: 1500, amountPaid: 1500 };
  const after = { amountDue: 1500, amountPaid: 1500 };
  assert.equal(assertReprintPreservesAmounts(before, after), true);

  const wrongAfter = { amountDue: 3000, amountPaid: 1500 };
  assert.equal(assertReprintPreservesAmounts(before, wrongAfter), false);
});

test("案例19/24：已收款取消需走退款流程，退款會反映在收款加總（財務報表與收款資料一致）", () => {
  const ledger: { kind: "PAYMENT" | "REFUND" | "TRANSFER_OUT" | "TRANSFER_IN"; amount: number }[] = [
    { kind: "PAYMENT", amount: 1500 },
  ];
  assert.equal(sumPaymentLedger(ledger), 1500);

  ledger.push({ kind: "REFUND", amount: 1500 });
  assert.equal(sumPaymentLedger(ledger), 0);
});

test("分次付款：多筆 PAYMENT 累加，不會只存最後一筆金額", () => {
  const ledger: { kind: "PAYMENT" | "REFUND" | "TRANSFER_OUT" | "TRANSFER_IN"; amount: number }[] = [
    { kind: "PAYMENT", amount: 500 },
    { kind: "PAYMENT", amount: 500 },
    { kind: "PAYMENT", amount: 500 },
  ];
  assert.equal(sumPaymentLedger(ledger), 1500);
});

test("轉款：TRANSFER_OUT 減少本筆已收金額，TRANSFER_IN 增加對應筆已收金額", () => {
  const sourceLedger = [
    { kind: "PAYMENT" as const, amount: 1500 },
    { kind: "TRANSFER_OUT" as const, amount: 1500 },
  ];
  assert.equal(sumPaymentLedger(sourceLedger), 0);

  const destLedger = [{ kind: "TRANSFER_IN" as const, amount: 1500 }];
  assert.equal(sumPaymentLedger(destLedger), 1500);
});

test("金額加總不會因為浮點數運算產生誤差（round2 四捨五入到小數點後兩位）", () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(computeAmountDue(3, 33.333, true), 100);
});

test("已收金額加總永遠不會是負數（即使退款總額超過已收金額，視同 0）", () => {
  const ledger = [
    { kind: "PAYMENT" as const, amount: 500 },
    { kind: "REFUND" as const, amount: 1500 },
  ];
  assert.equal(sumPaymentLedger(ledger), 0);
});

test("案例21：全年花果供品名單——依尚未認捐的日期過濾出正確清單", () => {
  const slots = generateFloralOfferingSlots();
  const claimedKeys = new Set(["1-1", "1-15", "3-1"]);
  const unclaimed = slots.filter((s) => !claimedKeys.has(`${s.lunarMonth}-${s.lunarDay}`));
  assert.equal(unclaimed.length, 21);
  assert.ok(!unclaimed.some((s) => s.lunarMonth === 1 && s.lunarDay === 1));
});

// ============================================================
// V26 供品管理適用活動範圍（需求「一、十一、十二」＋十五測試案例 1~6）
// ============================================================

test("案例2~6：四位主祀神明聖壽可出現在供品管理", () => {
  assert.ok(isOfferingActivityType("GUANDI_BIRTHDAY"), "關聖帝君聖壽");
  assert.ok(isOfferingActivityType("XUANTIAN_BIRTHDAY"), "玄天上帝聖壽");
  assert.ok(isOfferingActivityType("YAOCHI_BIRTHDAY"), "瑤池金母聖壽");
  assert.ok(isOfferingActivityType("ZHONGTAN_BIRTHDAY"), "中壇元帥聖壽");
});

test("案例6：宮慶可出現在供品管理", () => {
  assert.ok(isOfferingActivityType("TEMPLE_CELEBRATION"));
});

test("案例1：中元普渡不得出現在供品管理（核心 bug）", () => {
  assert.ok(!isOfferingActivityType("UNIVERSAL_SALVATION"), "中元普渡非供品核心活動");
  assert.ok(isExcludedFromOffering("UNIVERSAL_SALVATION"), "中元普渡屬明確排除清單");
});

test("各式燈／祭改／補庫／補印一律排除於供品管理", () => {
  for (const t of ["ANNUAL_LANTERN", "GUANGMING_LANTERN", "TAISUI_LANTERN", "FAMILY_LANTERN", "PURIFICATION", "STORAGE_REPAYMENT", "REPRINT"]) {
    assert.ok(!isOfferingActivityType(t), `${t} 非供品核心活動`);
    assert.ok(isExcludedFromOffering(t), `${t} 屬明確排除清單`);
  }
});

test("核心供品活動類型恰為四主祀聖壽＋宮慶（五種），且不含中元普渡", () => {
  assert.deepEqual(
    [...OFFERING_ACTIVITY_TYPES].sort(),
    ["GUANDI_BIRTHDAY", "TEMPLE_CELEBRATION", "XUANTIAN_BIRTHDAY", "YAOCHI_BIRTHDAY", "ZHONGTAN_BIRTHDAY"].sort()
  );
  assert.ok(!(OFFERING_ACTIVITY_TYPES as readonly string[]).includes("UNIVERSAL_SALVATION"));
  assert.ok((OFFERING_EXCLUDED_ACTIVITY_TYPES as readonly string[]).includes("UNIVERSAL_SALVATION"));
});

test("供品管理首頁查詢：使用核心供品活動類型、且不再硬列 UNIVERSAL_SALVATION／無條件 OTHER", () => {
  const page = readSrc("src/app/offering-center/page.tsx");
  assert.ok(/OFFERING_ACTIVITY_TYPES/.test(page), "改用共用的核心供品活動類型集合");
  // 舊 bug：where.in 硬列 UNIVERSAL_SALVATION 與無條件 OTHER。
  assert.ok(!/"UNIVERSAL_SALVATION"/.test(page), "首頁查詢不得再硬列中元普渡");
  // OTHER 僅在確實有供品設定時才列入（花果認捐等）。
  assert.ok(/activityType: "OTHER", activityOfferings: \{ some: \{\} \}/.test(page), "OTHER 僅在有供品設定時列入");
});

// ── 既有正式架構仍在（避免重建第二套；需求「六、十三」） ──
test("既有供品/認捐/收款/財務資料表仍存在（沿用同一套，不建第二套）", () => {
  const schema = readSrc("prisma/schema.prisma");
  for (const model of ["model OfferingType", "model ActivityOffering", "model FloralOfferingSlot", "model OfferingClaim", "model OfferingPayment"]) {
    assert.ok(schema.includes(model), `${model} 存在`);
  }
  // 認捐含應收/已收/未收、退款/沖銷、收據狀態欄位（財務串接與取消不刪紀錄）。
  assert.ok(/amountDue\s+Decimal/.test(schema) && /amountPaid\s+Decimal/.test(schema) && /amountUnpaid\s+Decimal/.test(schema), "應收/已收/未收欄位齊備");
  assert.ok(/refundedAmount\s+Decimal/.test(schema) && /model OfferingPayment[\s\S]*?kind\s+OfferingPaymentKind/.test(schema), "退款/沖銷以獨立收款紀錄保存，不刪除");
});

// ── 權限：READONLY 不得建立/收款；認捐建立只產生應收，收款另走 recordPayment（需求「八、九」） ──
test("READONLY 無任何供品寫入權限，只能查看歷史", () => {
  const perms = readSrc("src/lib/permissions.ts");
  assert.ok(/READONLY: \["viewFullHistory"\]/.test(perms), "READONLY 僅 viewFullHistory，無 createClaim/recordPayment 等寫入");
});

test("認捐建立走 createClaim 權限；收款是獨立的 recordPayment 動作（建立不自動計入已收）", () => {
  const createRoute = readSrc("src/app/api/temple-events/[id]/offering-claims/route.ts");
  assert.ok(/assertOfferingPermissionForOperator\(await readOperatorUserId\(request\), "createClaim"\)/.test(createRoute), "建立認捐檢查 createClaim 權限");
  const payRoute = readSrc("src/app/api/offering-claims/[id]/payments/route.ts");
  assert.ok(/assertOfferingPermissionForOperator\(await readOperatorUserId\(request\), "recordPayment"\)/.test(payRoute), "收款檢查 recordPayment 權限（與建立分離）");
});

// ============================================================
// V26.1「供品活動模板」：建立活動自動建立預設供品
// ============================================================

test("四位主祀神明聖壽模板 = 壽桃麵塔＋散壽桃麵（數量沿用預設）", () => {
  for (const t of ["GUANDI_BIRTHDAY", "XUANTIAN_BIRTHDAY", "YAOCHI_BIRTHDAY", "ZHONGTAN_BIRTHDAY"]) {
    const tpl = getOfferingTemplate(t);
    assert.deepEqual(
      tpl.map((e) => e.offeringName),
      ["壽桃麵塔", "散壽桃麵"],
      `${t} 應有壽桃麵塔＋散壽桃麵`
    );
    // 數量沿用預設（null 由 addActivityOffering 帶入 OfferingType.defaultQuantity）。
    assert.ok(tpl.every((e) => e.quantity === null), `${t} 數量皆沿用預設`);
  }
});

test("宮慶模板 = 大福壽龜(1)＋小福壽龜(6)＋壽桃麵塔＋散壽桃麵", () => {
  const tpl = getOfferingTemplate("TEMPLE_CELEBRATION");
  assert.deepEqual(
    tpl.map((e) => e.offeringName),
    ["大福壽龜", "小福壽龜", "壽桃麵塔", "散壽桃麵"]
  );
  const byName = Object.fromEntries(tpl.map((e) => [e.offeringName, e.quantity]));
  assert.equal(byName["大福壽龜"], 1, "大福壽龜預設 1 隻");
  assert.equal(byName["小福壽龜"], 6, "小福壽龜預設 6 隻");
  assert.equal(byName["壽桃麵塔"], null, "壽桃麵塔沿用預設");
  assert.equal(byName["散壽桃麵"], null, "散壽桃麵沿用預設");
});

test("沒有模板的活動類型（普渡/各式燈/祭改/其他）回傳空陣列，不建立任何預設供品", () => {
  for (const t of ["UNIVERSAL_SALVATION", "ANNUAL_LANTERN", "PURIFICATION", "STORAGE_REPAYMENT", "OTHER", "REPRINT"]) {
    assert.deepEqual(getOfferingTemplate(t), [], `${t} 無預設供品模板`);
  }
});

test("模板只涵蓋核心供品活動類型（四聖壽＋宮慶），與 OFFERING_ACTIVITY_TYPES 一致", () => {
  const templateKeys = Object.keys(OFFERING_ACTIVITY_TEMPLATES).sort();
  assert.deepEqual(templateKeys, [...OFFERING_ACTIVITY_TYPES].sort());
});

test("模板引用的供品名稱都存在於預設供品種類（DEFAULT_OFFERING_TYPES）", () => {
  const offeringTypes = readSrc("src/lib/offeringTypes.ts");
  const names = new Set<string>();
  for (const t of Object.values(OFFERING_ACTIVITY_TEMPLATES)) for (const e of t) names.add(e.offeringName);
  for (const name of names) {
    assert.ok(offeringTypes.includes(`name: "${name}"`), `DEFAULT_OFFERING_TYPES 含「${name}」`);
  }
});

test("createTempleEvent 全新建立會呼叫 seedDefaultActivityOfferings；複製去年路徑不重覆補預設", () => {
  const src = readSrc("src/lib/templeEvents.ts");
  // 全新建立路徑（seedChecklist 之後）呼叫 seed。
  assert.ok(
    /await seedChecklist\(created\.id[\s\S]*?await seedDefaultActivityOfferings\(created\.id, input\.activityType/.test(src),
    "createTempleEvent 建立後呼叫 seedDefaultActivityOfferings"
  );
  // 複製去年路徑用 copyActivityOfferingsForNewEvent 沿用去年設定，不呼叫 seed 預設。
  assert.ok(/copyActivityOfferingsForNewEvent/.test(src), "複製去年活動沿用去年供品設定");
});

test("seedDefaultActivityOfferings 不重複建立：已存在即略過、沿用唯一鍵", () => {
  const src = readSrc("src/lib/activityOfferings.ts");
  assert.ok(/templeEventId_offeringTypeId:\s*{\s*templeEventId,\s*offeringTypeId/.test(src), "以唯一鍵查既有供品");
  assert.ok(/if \(existing\) \{[\s\S]*?skippedCount \+= 1;[\s\S]*?continue;/.test(src), "已存在則略過不重建");
});

test("提供舊活動補齊 API：POST offerings/seed-defaults", () => {
  const route = readSrc("src/app/api/temple-events/[id]/offerings/seed-defaults/route.ts");
  assert.ok(/export async function POST/.test(route), "seed-defaults 路由有 POST");
  assert.ok(/seedDefaultActivityOfferings\(id, event\.activityType/.test(route), "呼叫 seeder 補齊");
  assert.ok(/assertActivityPermissionForOperator[\s\S]*?"manageSettings"/.test(route), "需 manageSettings 權限");
});

// ============================================================
// V26.2「供品管理」：分層畫面 + 完整認捐/收款/退款串接
// ============================================================

test("供品卡片顯示應收/已收/未收，且設定與認捐分層（編輯設定 / 新增認捐 / 認捐名單）", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  for (const label of ["應收", "已收", "未收", "編輯設定", "新增認捐", "認捐名單"]) {
    assert.ok(panel.includes(label), `畫面包含「${label}」`);
  }
});

test("編輯設定串接 PATCH activity-offering（活動層單價/日期/狀態）", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/method:\s*"PATCH"[\s\S]*?offerings\/\$\{offering\.id\}/.test(panel) || /offerings\/\$\{offering\.id\}`,\s*\{\s*method:\s*"PATCH"/.test(panel), "PATCH 活動供品設定");
  assert.ok(/useDefaultPrice/.test(panel) && /claimStartDate/.test(panel) && /claimEndDate/.test(panel), "含使用預設單價/開放/截止");
});

test("新增認捐把當下有效單價存為 unitPrice 快照，未當場收費不寫已收", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/offering-claims`,\s*\{[\s\S]*?unitPrice:/.test(panel), "建立認捐帶 unitPrice 快照");
  assert.ok(/chargeNow/.test(panel), "有『當場收費』切換");
  assert.ok(/offering-claims\/\$\{data\.id\}\/payments/.test(panel), "當場收費才走既有 OfferingPayment 收款");
});

test("認捐名單提供 修改 / 收款(補收款) / 取消 / 退款沖銷，沿用既有 API", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/offering-claims\/\$\{claim\.id\}`,\s*\{[\s\S]*?method:\s*"PATCH"/.test(panel), "修改走 PATCH claim");
  assert.ok(/offering-claims\/\$\{claim\.id\}\/payments/.test(panel), "收款/補收款走 payments");
  assert.ok(/offering-claims\/\$\{claim\.id\}\/cancel/.test(panel), "取消走 cancel");
  assert.ok(/offering-claims\/\$\{claim\.id\}\/refund/.test(panel), "退款/沖銷走 refund");
});

test("後端：建立認捐存單價快照且不自動計為已收（amountPaid=0、amountUnpaid=amountDue）", () => {
  const src = readSrc("src/lib/offeringClaims.ts");
  assert.ok(/unitPrice,\s*[\s\S]*?amountDue,\s*[\s\S]*?amountPaid:\s*0,\s*[\s\S]*?amountUnpaid:\s*amountDue/.test(src), "建立認捐 amountPaid=0、未收=應收");
  assert.ok(/computeAmountDue\(quantity, unitPrice/.test(src), "應收 = 數量 × 單價快照");
});

test("後端：修改活動單價不回頭改既有認捐（認捐讀存在 claim 上的 unitPrice 快照）", () => {
  const src = readSrc("src/lib/offeringClaims.ts");
  // 修改活動供品價格的函式不觸碰既有 OfferingClaim；認捐金額一律用 claim.unitPrice 快照重算。
  assert.ok(/直接讀存在 claim 上的 unitPrice\/amountDue 快照/.test(src), "歷史金額用快照，不受活動單價調整影響");
});

// ============================================================
// V26.3「供品認捐取消 UX」：名單篩選（不刪資料，只調整顯示/查詢）
// ============================================================

test("名單提供 全部/進行中/未收款/已收款/已取消 五個篩選，預設進行中", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  for (const label of ["全部", "進行中", "未收款", "已收款", "已取消"]) {
    assert.ok(panel.includes(`label: "${label}"`), `篩選含「${label}」`);
  }
  assert.ok(/useState<ClaimFilter>\("ACTIVE"\)/.test(panel), "預設篩選＝進行中(ACTIVE)");
});

test("進行中/未收款/已收款只含 ACTIVE；已取消含 CANCELLED/REFUND_PENDING/REFUNDED（取消紀錄保留可查）", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/case "ACTIVE":\s*return claim\.status === "ACTIVE";/.test(panel), "進行中只含 ACTIVE");
  assert.ok(/case "CANCELLED":\s*return claim\.status === "CANCELLED" \|\| claim\.status === "REFUND_PENDING" \|\| claim\.status === "REFUNDED";/.test(panel), "已取消含三種取消/退款狀態");
});

test("名單依篩選顯示（displayedClaims），預設進行中不會列出已取消", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/displayedClaims = \(claims \?\? \[\]\)\.filter\(\(c\) => matchesClaimFilter\(c, claimFilter\)\)/.test(panel), "以 matchesClaimFilter 篩選名單");
  assert.ok(/displayedClaims\.map/.test(panel), "只渲染符合篩選的認捐");
});

test("取消後即時更新數量：取消走 onChanged→afterClaimChange→loadClaims 重新計算已認捐/剩餘，不需整頁重整", () => {
  const panel = readSrc("src/components/offering/ActivityOfferingsPanel.tsx");
  assert.ok(/async function cancelClaim\(\)[\s\S]*?onChanged\(\);/.test(panel), "取消成功後呼叫 onChanged");
  assert.ok(/async function afterClaimChange\(\) \{\s*await loadClaims\(\);/.test(panel), "afterClaimChange 重新載入認捐（即時更新統計）");
  // 已認捐/剩餘由 ACTIVE||REFUND_PENDING 的 activeClaims 計算，取消未收款(→CANCELLED)後即被排除。
  assert.ok(/CLAIM_ACTIVE_STATUSES = new Set\(\["ACTIVE", "REFUND_PENDING"\]\)/.test(panel), "數量統計基準為 ACTIVE/REFUND_PENDING");
});

test("已收款不得直接取消：沿用既有後端 cancelOfferingClaim（已收→REFUND_PENDING 走退款流程）", () => {
  const src = readSrc("src/lib/offeringClaims.ts");
  assert.ok(/const hasBeenPaid = Number\(existing\.amountPaid\) > 0;/.test(src), "以已收金額判斷");
  assert.ok(/hasBeenPaid \? "REFUND_PENDING" : "CANCELLED"/.test(src), "已收款轉 REFUND_PENDING、未收款才直接 CANCELLED");
});
