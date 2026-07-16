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
} from "../src/lib/offeringRules";

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
