import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canCollection,
  canOffering,
  canActivity,
  canTemplate,
  canPurification,
  canSystem,
  type Role,
} from "../src/lib/permissions";

/**
 * V14.3 權限矩陣測試（四角色實際規則，非推理）。
 * 對應驗收：READONLY 只讀、STAFF 不可刪除/匯入/使用者管理/seed/備份還原、
 * ADMIN 不可管理使用者/系統設定/備份還原/seed、SUPER_ADMIN 全開。
 */

test("READONLY：所有寫入動作一律禁止，只讀允許", () => {
  const r: Role = "READONLY";
  assert.equal(canCollection(r, "recordPayment"), false);
  assert.equal(canCollection(r, "voidPayment"), false);
  assert.equal(canCollection(r, "refund"), false);
  assert.equal(canOffering(r, "recordPayment"), false);
  assert.equal(canActivity(r, "update"), false);
  assert.equal(canActivity(r, "print"), false);
  assert.equal(canPurification(r, "create"), false);
  assert.equal(canPurification(r, "print"), false);
  assert.equal(canTemplate(r, "activate"), false);
  // 只讀允許
  assert.equal(canActivity(r, "view"), true);
  assert.equal(canPurification(r, "view"), true);
  assert.equal(canTemplate(r, "view"), true);
});

test("STAFF：日常允許；刪除/匯入/使用者管理/seed/備份還原/核心設定禁止", () => {
  const r: Role = "STAFF";
  // 允許
  assert.equal(canCollection(r, "recordPayment"), true);
  assert.equal(canActivity(r, "manageParticipants"), true);
  assert.equal(canActivity(r, "print"), true);
  assert.equal(canPurification(r, "create"), true);
  assert.equal(canPurification(r, "print"), true);
  assert.equal(canPurification(r, "reprint"), true);
  // 禁止
  assert.equal(canActivity(r, "delete"), false);
  assert.equal(canActivity(r, "import"), false);
  assert.equal(canActivity(r, "manageSettings"), false);
  assert.equal(canActivity(r, "manageExpenses"), false);
  assert.equal(canCollection(r, "voidPayment"), false);
  assert.equal(canCollection(r, "refund"), false);
  assert.equal(canPurification(r, "manageYears"), false);
  assert.equal(canPurification(r, "manageBannedNumbers"), false);
  assert.equal(canPurification(r, "delete"), false);
  assert.equal(canTemplate(r, "activate"), false);
  assert.equal(canTemplate(r, "seed"), false);
  assert.equal(canTemplate(r, "create"), false);
  assert.equal(canSystem(r, "manageUsers"), false);
  assert.equal(canSystem(r, "manageRecycleBin"), false);
  assert.equal(canSystem(r, "restoreBackup"), false);
  assert.equal(canOffering(r, "permanentlyDelete"), false);
});

test("ADMIN：模組管理可；使用者管理/系統設定/備份還原/seed/永久刪除禁止", () => {
  const r: Role = "ADMIN";
  // 允許
  assert.equal(canCollection(r, "recordPayment"), true);
  assert.equal(canCollection(r, "voidPayment"), true);
  assert.equal(canCollection(r, "refund"), true);
  assert.equal(canActivity(r, "create"), true);
  assert.equal(canActivity(r, "manageSettings"), true);
  assert.equal(canActivity(r, "import"), true);
  assert.equal(canPurification(r, "manageYears"), true);
  assert.equal(canPurification(r, "manageBannedNumbers"), true);
  assert.equal(canTemplate(r, "create"), true);
  assert.equal(canTemplate(r, "activate"), true);
  assert.equal(canSystem(r, "manageRecycleBin"), true);
  // 禁止
  assert.equal(canSystem(r, "manageUsers"), false);
  assert.equal(canSystem(r, "viewSystemCenter"), false);
  assert.equal(canSystem(r, "restoreBackup"), false);
  assert.equal(canSystem(r, "manageBackupSchedule"), false);
  assert.equal(canTemplate(r, "seed"), false);
  assert.equal(canTemplate(r, "delete"), false);
  assert.equal(canActivity(r, "delete"), false);
});

test("SUPER_ADMIN：全部合法管理動作允許", () => {
  const r: Role = "SUPER_ADMIN";
  assert.equal(canCollection(r, "voidPayment"), true);
  assert.equal(canOffering(r, "permanentlyDelete"), true);
  assert.equal(canActivity(r, "delete"), true);
  assert.equal(canActivity(r, "import"), true);
  assert.equal(canTemplate(r, "seed"), true);
  assert.equal(canTemplate(r, "delete"), true);
  assert.equal(canPurification(r, "delete"), true);
  assert.equal(canSystem(r, "manageUsers"), true);
  assert.equal(canSystem(r, "restoreBackup"), true);
  assert.equal(canSystem(r, "manageRecycleBin"), true);
});
