import { test } from "node:test";
import assert from "node:assert/strict";
import { canDevotee } from "../src/lib/permissions";

/**
 * V28 權限 regression（純函式，沙盒可直接跑）：
 *
 * - 祭祀資料 編輯／封存／恢復 對應 updateProfile：SUPER_ADMIN／ADMIN／STAFF 可，READONLY／FINANCE_CLERK 不可。
 * - 成員 封存／恢復／移出（含建立個人戶）對應結構性 transferMember：僅 SUPER_ADMIN／ADMIN。
 * - 家戶封存對應 archiveHousehold：僅 SUPER_ADMIN／ADMIN。
 *
 * 這確保 V28 新 API 沿用既有權限矩陣，沒有放寬給不該有權限的角色。
 */

test("祭祀資料維護（updateProfile）：STAFF 以上可、READONLY/FINANCE_CLERK 不可", () => {
  assert.equal(canDevotee("SUPER_ADMIN", "updateProfile"), true);
  assert.equal(canDevotee("ADMIN", "updateProfile"), true);
  assert.equal(canDevotee("STAFF", "updateProfile"), true);
  assert.equal(canDevotee("READONLY", "updateProfile"), false);
  assert.equal(canDevotee("FINANCE_CLERK", "updateProfile"), false);
});

test("成員封存／移出（transferMember）：僅 SUPER_ADMIN／ADMIN", () => {
  assert.equal(canDevotee("SUPER_ADMIN", "transferMember"), true);
  assert.equal(canDevotee("ADMIN", "transferMember"), true);
  assert.equal(canDevotee("STAFF", "transferMember"), false);
  assert.equal(canDevotee("READONLY", "transferMember"), false);
  assert.equal(canDevotee("FINANCE_CLERK", "transferMember"), false);
});

test("家戶封存（archiveHousehold）：僅 SUPER_ADMIN／ADMIN", () => {
  assert.equal(canDevotee("SUPER_ADMIN", "archiveHousehold"), true);
  assert.equal(canDevotee("ADMIN", "archiveHousehold"), true);
  assert.equal(canDevotee("STAFF", "archiveHousehold"), false);
  assert.equal(canDevotee("READONLY", "archiveHousehold"), false);
});
