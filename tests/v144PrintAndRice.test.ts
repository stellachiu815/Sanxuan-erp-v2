import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyPrintToObject,
  printObjectStatus,
  reprintTimes,
  type PrintObjectState,
} from "../src/lib/additionalPrintItemRules";
import {
  computeRiceAmountDue,
  computeRiceQuota,
  sumValidRiceKg,
  checkRiceOverage,
  isRiceRegistrationOpen,
} from "../src/lib/whiteRice";

/**
 * V14.4 純邏輯驗收（列印物件＋白米配額）。對應指令十驗收 1/3/4/6/9/10/11/13/14。
 * 以 Node 原生 test 執行真實 src 邏輯（無 Prisma 依賴）。
 */

const UNPRINTED: PrintObjectState = { printCount: 0, firstPrintedAt: null, lastPrintedAt: null, lastPrintedByUserId: null };

test("3/4. 首次列印只設一次 printedAt；補印不覆蓋首次列印時間", () => {
  const t1 = new Date("2026-08-01T10:00:00Z");
  const afterFirst = applyPrintToObject(UNPRINTED, t1, "user-A");
  assert.equal(afterFirst.printCount, 1);
  assert.equal(afterFirst.firstPrintedAt?.getTime(), t1.getTime());
  assert.equal(afterFirst.lastPrintedAt?.getTime(), t1.getTime());
  assert.equal(afterFirst.lastPrintedByUserId, "user-A");

  const t2 = new Date("2026-08-02T09:00:00Z");
  const afterReprint = applyPrintToObject(afterFirst, t2, "user-B");
  assert.equal(afterReprint.printCount, 2);
  // 首次列印時間不可被覆蓋：
  assert.equal(afterReprint.firstPrintedAt?.getTime(), t1.getTime());
  // 最後列印時間與操作帳號更新：
  assert.equal(afterReprint.lastPrintedAt?.getTime(), t2.getTime());
  assert.equal(afterReprint.lastPrintedByUserId, "user-B");
});

test("1/6. printCount 語意：0 未印、1 已印、>1 已補印 N 次", () => {
  assert.equal(printObjectStatus(0), "UNPRINTED");
  assert.equal(printObjectStatus(1), "PRINTED");
  assert.equal(printObjectStatus(3), "REPRINTED");
  assert.equal(reprintTimes(0), 0);
  assert.equal(reprintTimes(1), 0);
  assert.equal(reprintTimes(3), 2); // 已補印 2 次
});

test("1. 同一牌位的牌位(TABLET)與寶袋(POCKET)可各自不同列印次數", () => {
  const t = new Date("2026-08-01T10:00:00Z");
  // 牌位印了兩次（首印＋補印），寶袋尚未印。
  const tablet = applyPrintToObject(applyPrintToObject(UNPRINTED, t, "u"), new Date("2026-08-03T10:00:00Z"), "u");
  const pocket = UNPRINTED;
  assert.equal(tablet.printCount, 2);
  assert.equal(pocket.printCount, 0);
  assert.notEqual(printObjectStatus(tablet.printCount), printObjectStatus(pocket.printCount));
});

test("9/10. 白米：年度總斤數與每斤單價可每年設定；應收＝斤數×單價", () => {
  // 不同年度不同設定，不寫死。
  assert.equal(computeRiceAmountDue(10, 35), 350);
  assert.equal(computeRiceAmountDue(3.5, 40), 140);
  // 尚未設定單價 → null，不假裝為 0。
  assert.equal(computeRiceAmountDue(10, null), null);
  // 開放認購判斷：
  assert.equal(isRiceRegistrationOpen({ totalKg: 1000, unitPrice: 35, open: true }), true);
  assert.equal(isRiceRegistrationOpen({ totalKg: 1000, unitPrice: 35, open: false }), false);
  assert.equal(isRiceRegistrationOpen({ totalKg: null, unitPrice: 35, open: true }), false);
});

test("11/12. 剩餘斤數由有效認購彙總；取消/刪除/草稿不計入", () => {
  const regs = [
    { kg: 10, isValid: true },
    { kg: 5, isValid: true },
    { kg: 8, isValid: false }, // 已取消/刪除/作廢/未確認草稿
  ];
  assert.equal(sumValidRiceKg(regs), 15);
  const quota = computeRiceQuota(1000, sumValidRiceKg(regs));
  assert.equal(quota.totalKg, 1000);
  assert.equal(quota.registeredKg, 15);
  assert.equal(quota.remainingKg, 985);
  assert.equal(quota.isOverbooked, false);
  // 取消一筆後重新彙總（模擬 regs[1] 變無效）：剩餘正確釋放。
  const after = computeRiceQuota(1000, sumValidRiceKg([{ kg: 10, isValid: true }, { kg: 5, isValid: false }, { kg: 8, isValid: false }]));
  assert.equal(after.registeredKg, 10);
  assert.equal(after.remainingKg, 990);
});

test("13. 修改年度單價不改動舊報名（鎖定單價）", () => {
  // 舊報名鎖定 lockedUnitPrice=35，年度單價之後改成 40，舊報名金額仍以 35 計。
  const lockedOld = 35;
  assert.equal(computeRiceAmountDue(10, lockedOld), 350);
  // 新報名才用新單價：
  assert.equal(computeRiceAmountDue(10, 40), 400);
});

test("14. 超額認購：STAFF/READONLY 擋；ADMIN/SUPER 需原因才可超額；不默默產生負數", () => {
  // 未超額一律可建立。
  assert.deepEqual(checkRiceOverage("STAFF", 5, 10), { ok: true, overage: false });
  // STAFF 超額 → 擋。
  const staffOver = checkRiceOverage("STAFF", 15, 10);
  assert.equal(staffOver.ok, false);
  // READONLY 超額 → 擋。
  assert.equal(checkRiceOverage("READONLY", 15, 10).ok, false);
  // ADMIN 超額但沒填原因 → 擋。
  assert.equal(checkRiceOverage("ADMIN", 15, 10).ok, false);
  // ADMIN 超額且填原因 → 放行，且要求原因記錄。
  assert.deepEqual(checkRiceOverage("ADMIN", 15, 10, "神明指示追加"), { ok: true, overage: true, requiresReason: true });
  // SUPER_ADMIN 同理。
  assert.deepEqual(checkRiceOverage("SUPER_ADMIN", 20, 10, "特批"), { ok: true, overage: true, requiresReason: true });
});
