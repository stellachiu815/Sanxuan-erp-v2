import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateAllocationsMatchTotal,
  formatTransactionNo,
  buildFinanceSourceKey,
  buildAdjustmentFinanceSourceKey,
  buildReconciliationFinanceSourceKey,
  computeReconciliationDifference,
  validateAdjustmentAmount,
  deriveUniversalPaymentStatus,
  validatePaymentDoesNotExceedUnpaid,
  resolveFeeStatusUpdate,
} from "../src/lib/collectionCenterRules";

// V11.0「全宮共用收款中心」自動測試——對應需求「二十六、自動測試」列出的
// 情境裡，可以脫離資料庫獨立驗證的純規則部分（跟 Prisma 有關的合併收款/
// 退款轉款/代收對帳整合行為，在 src/lib/collectionCenter.ts 裡用程式碼
// 保證，並在真實 PostgreSQL 上以 SQL 走查驗證，見交付報告）。

test("合併收款情境：福壽龜3000+花果1500+燈600+油香2000=7100，四筆分配加總必須等於收款總額", () => {
  const allocations = [{ amount: 3000 }, { amount: 1500 }, { amount: 600 }, { amount: 2000 }];
  const result = validateAllocationsMatchTotal(allocations, 7100);
  assert.equal(result.ok, true);
});

test("分配金額加總對不上收款總額時，必須被擋下", () => {
  const allocations = [{ amount: 3000 }, { amount: 1500 }];
  const result = validateAllocationsMatchTotal(allocations, 5000);
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /不相符/);
});

test("不可建立四筆互不相干的實際收款主紀錄——分配項目不得為空", () => {
  const result = validateAllocationsMatchTotal([], 1000);
  assert.equal(result.ok, false);
});

test("任一筆分配金額為 0 或負數時必須被擋下", () => {
  const result = validateAllocationsMatchTotal([{ amount: 3000 }, { amount: 0 }], 3000);
  assert.equal(result.ok, false);
});

test("收款序號格式為 PT-{年度}-{6位數流水號}", () => {
  assert.equal(formatTransactionNo(115, 1), "PT-115-000001");
  assert.equal(formatTransactionNo(115, 123456), "PT-115-123456");
});

test("財務來源識別碼由來源類型/來源id/交易id組成，同一筆交易同一個來源只會有一個識別碼", () => {
  const key = buildFinanceSourceKey("OFFERING_CLAIM", "OC_1", "PT_1");
  assert.equal(key, "OFFERING_CLAIM:OC_1:PT_1");
});

test("代收對帳：實際繳回金額等於預期金額時不需要填寫差異原因", () => {
  const result = computeReconciliationDifference(10000, 10000);
  assert.equal(result.differenceAmount, 0);
  assert.equal(result.requiresReason, false);
});

test("代收對帳：實際≠預期時，必須要求填寫差異原因", () => {
  const result = computeReconciliationDifference(10000, 9500);
  assert.equal(result.differenceAmount, -500);
  assert.equal(result.requiresReason, true);
});

test("退款/轉款金額不得超過原始分配金額", () => {
  const ok = validateAdjustmentAmount(3000, 3000);
  assert.equal(ok.ok, true);
  const tooMuch = validateAdjustmentAmount(3000, 3000.01);
  assert.equal(tooMuch.ok, false);
});

test("退款/轉款金額必須大於 0", () => {
  const result = validateAdjustmentAmount(3000, 0);
  assert.equal(result.ok, false);
});

// V11.0.1 新增：統一付款狀態計算（8 種狀態，所有來源共用同一套規則）

test("統一狀態：生命週期狀態優先於金額判斷（已取消一律是 CANCELLED）", () => {
  const status = deriveUniversalPaymentStatus({ lifecycleStatus: "CANCELLED", amountDue: 1000, amountPaid: 1000, isWaived: false });
  assert.equal(status, "CANCELLED");
});

test("統一狀態：待退款/已退款/已轉款直接對應生命週期狀態，不受金額影響", () => {
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "REFUND_PENDING", amountDue: 1000, amountPaid: 1000, isWaived: false }), "REFUND_PENDING");
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "REFUNDED", amountDue: 1000, amountPaid: 0, isWaived: false }), "REFUNDED");
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "TRANSFERRED", amountDue: 1000, amountPaid: 0, isWaived: false }), "TRANSFERRED");
});

test("統一狀態：免收固定為 WAIVED", () => {
  const status = deriveUniversalPaymentStatus({ lifecycleStatus: "ACTIVE", amountDue: 0, amountPaid: 0, isWaived: true });
  assert.equal(status, "WAIVED");
});

test("統一狀態：未付款/部分付款/已付款依金額判斷", () => {
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "ACTIVE", amountDue: 1000, amountPaid: 0, isWaived: false }), "UNPAID");
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "ACTIVE", amountDue: 1000, amountPaid: 500, isWaived: false }), "PARTIAL");
  assert.equal(deriveUniversalPaymentStatus({ lifecycleStatus: "ACTIVE", amountDue: 1000, amountPaid: 1000, isWaived: false }), "PAID");
});

test("統一狀態：應收金額為 null（例如祭改尚未設定金額）視同 0，不會誤判成有欠款", () => {
  const status = deriveUniversalPaymentStatus({ lifecycleStatus: "ACTIVE", amountDue: null, amountPaid: 0, isWaived: false });
  assert.equal(status, "PAID");
});

// V11.0.1 新增：防止重複收款——本次金額不得超過即時未收金額

test("收款金額不得超過目前未收金額（防止依賴前端畫面的舊金額）", () => {
  const ok = validatePaymentDoesNotExceedUnpaid(1000, 1000);
  assert.equal(ok.ok, true);
  const tooMuch = validatePaymentDoesNotExceedUnpaid(1000.01, 1000);
  assert.equal(tooMuch.ok, false);
});

test("收款金額必須大於 0", () => {
  const result = validatePaymentDoesNotExceedUnpaid(0, 1000);
  assert.equal(result.ok, false);
});

// V11.0.1 新增：退款/轉款/作廢的財務來源識別碼——跟收款事件的識別碼是
// 兩組不同命名空間，不會互相阻擋合法的「先收款、後退款」流程

test("退款/轉款財務來源識別碼由 ADJUSTMENT 前綴＋分配id＋調整紀錄id組成", () => {
  const key = buildAdjustmentFinanceSourceKey("ALLOC_1", "ADJ_1");
  assert.equal(key, "ADJUSTMENT:ALLOC_1:ADJ_1");
});

test("同一筆分配的收款識別碼與退款識別碼命名空間不同，不會撞號", () => {
  const paymentKey = buildFinanceSourceKey("OFFERING_CLAIM", "OC_1", "PT_1");
  const adjustmentKey = buildAdjustmentFinanceSourceKey("ALLOC_1", "ADJ_1");
  assert.notEqual(paymentKey, adjustmentKey);
});

// V11.0.2 新增：代收對帳批次的財務識別碼——第三組獨立命名空間，代收繳回
// 不是收入事件，不得跟收款/退款識別碼混用或撞號

test("代收對帳財務識別碼由 RECONCILIATION 前綴＋代收人＋對帳紀錄id組成", () => {
  const key = buildReconciliationFinanceSourceKey("代收人張三", "ARR_1");
  assert.equal(key, "RECONCILIATION:代收人張三:ARR_1");
});

test("代收對帳識別碼跟收款/退款識別碼命名空間都不同，三者不會互相撞號", () => {
  const paymentKey = buildFinanceSourceKey("OFFERING_CLAIM", "OC_1", "PT_1");
  const adjustmentKey = buildAdjustmentFinanceSourceKey("ALLOC_1", "ADJ_1");
  const reconciliationKey = buildReconciliationFinanceSourceKey("代收人張三", "ARR_1");
  const all = new Set([paymentKey, adjustmentKey, reconciliationKey]);
  assert.equal(all.size, 3);
});

// V11.0.2 新增：祭改「未設定／收費／免收」三態切換規則（對應需求「十、
// 自動測試補強」第 2 項），從 src/lib/purification.ts 抽出的純函式

test("祭改設為收費（CHARGEABLE）且有帶應收金額：正確計算未收金額", () => {
  const result = resolveFeeStatusUpdate({
    feeStatus: "CHARGEABLE",
    amountDue: 800,
    existingFeeStatus: "UNSET",
    existingAmountDue: null,
    existingAmountPaid: 0,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.feeStatus, "CHARGEABLE");
    assert.equal(result.amountDue, 800);
    assert.equal(result.amountUnpaid, 800);
  }
});

test("祭改設為收費卻沒有任何可用的應收金額：必須被擋下，不得猜測金額", () => {
  const result = resolveFeeStatusUpdate({
    feeStatus: "CHARGEABLE",
    amountDue: undefined,
    existingFeeStatus: "UNSET",
    existingAmountDue: null,
    existingAmountPaid: 0,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /應收金額/);
});

test("祭改設為免收（WAIVED）：應收/未收金額一律清空，不建立應收", () => {
  const result = resolveFeeStatusUpdate({
    feeStatus: "WAIVED",
    existingFeeStatus: "CHARGEABLE",
    existingAmountDue: 500,
    existingAmountPaid: 200,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.amountDue, null);
    assert.equal(result.amountUnpaid, 0);
  }
});

test("祭改設為尚未設定（UNSET）：應收/未收金額一律清空", () => {
  const result = resolveFeeStatusUpdate({
    feeStatus: "UNSET",
    existingFeeStatus: "CHARGEABLE",
    existingAmountDue: 500,
    existingAmountPaid: 0,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.amountDue, null);
    assert.equal(result.amountUnpaid, 0);
  }
});

test("祭改已經是收費狀態，只更新應收金額（不改 feeStatus）：正確重算未收金額", () => {
  const result = resolveFeeStatusUpdate({
    amountDue: 1000,
    existingFeeStatus: "CHARGEABLE",
    existingAmountDue: 500,
    existingAmountPaid: 300,
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.feeStatus, undefined);
    assert.equal(result.amountDue, 1000);
    assert.equal(result.amountUnpaid, 700);
  }
});
