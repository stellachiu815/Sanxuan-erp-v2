import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canDevotee,
  canActivity,
  canRitualRegistration,
  canCollection,
  canFinance,
  canUniversalSalvation,
  canReceipt,
  canSystem,
  canTemplate,
  canApproveReceiptVoidOrReissue,
  type Role,
} from "../src/lib/permissions";

/**
 * V23 使用者/角色/權限總驗收——逐模組權限矩陣（四種正式角色）。
 * 只驗證既有 can*() 純函式的判定，不修改任何權限架構。
 */

const OFFICIAL_ROLES: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY"];

// 各模組完整動作清單（供 SUPER⊇ADMIN 與 READONLY 不可寫入 等不變式）。
const DEVOTEE_MUTATIONS = ["createProfile", "updateProfile", "manageTags", "applyTag", "createInteraction", "manageInteractions", "manageCareList", "mergeHousehold", "splitHousehold", "transferMember", "changeHouseholdCode", "archiveHousehold"] as const;
const ACTIVITY_ALL = ["view", "create", "update", "delete", "manageSettings", "manageParticipants", "manageExpenses", "import", "print"] as const;
const ACTIVITY_MUTATIONS = ACTIVITY_ALL.filter((a) => a !== "view");
const COLLECTION_ALL = ["view", "recordPayment", "voidPayment", "refund", "reconcile", "manageManualReceivable"] as const;
const FINANCE_ALL = ["view", "viewFullReport", "create", "update", "void", "export", "createEntry", "transfer", "reconcile", "correct", "manageOpening"] as const;
const US_ALL = ["view", "create", "update", "delete", "restore", "print", "reprint"] as const;
const RECEIPT_ALL = ["view", "issue", "markNoReceiptRequired", "print", "reprint", "void", "reissue", "manageSettings", "manageNumbering", "exportData", "viewAuditLog"] as const;
const SYSTEM_ALL = ["viewSystemCenter", "runBackup", "downloadBackup", "restoreBackup", "manageGoogleDriveConnection", "manageBackupSchedule", "manageDataImport", "manageRecycleBin", "purgeRecycleBin", "manageUsers", "runAcceptanceScan"] as const;
const TEMPLATE_ALL = ["view", "create", "update", "activate", "seed", "delete"] as const;

test("信眾管理：STAFF 可新增/修改；READONLY 只讀；合併等結構動作 STAFF 一律不可", () => {
  assert.ok(canDevotee("STAFF", "createProfile") && canDevotee("STAFF", "updateProfile"));
  assert.ok(canDevotee("STAFF", "viewFullNationalId"), "第一線需核對證件");
  for (const a of DEVOTEE_MUTATIONS) assert.ok(!canDevotee("READONLY", a), `READONLY 不可 ${a}`);
});

test("家戶管理：合併/拆分/轉移/改編號/封存 僅 SUPER_ADMIN 與 ADMIN", () => {
  for (const a of ["mergeHousehold", "splitHousehold", "transferMember", "changeHouseholdCode", "archiveHousehold"] as const) {
    assert.ok(canDevotee("SUPER_ADMIN", a) && canDevotee("ADMIN", a), `SUPER/ADMIN 可 ${a}`);
    assert.ok(!canDevotee("STAFF", a) && !canDevotee("READONLY", a), `STAFF/READONLY 不可 ${a}`);
  }
});

test("活動管理：STAFF 限一般更新/參與人/列印；建立/匯入/支出/設定/刪除禁止；刪除僅 SUPER_ADMIN", () => {
  assert.ok(canActivity("STAFF", "update") && canActivity("STAFF", "manageParticipants") && canActivity("STAFF", "print"));
  for (const a of ["create", "delete", "import", "manageExpenses", "manageSettings"] as const) assert.ok(!canActivity("STAFF", a), `STAFF 不可 ${a}`);
  assert.ok(canActivity("SUPER_ADMIN", "delete") && canActivity("ADMIN", "delete"), "V39：ADMIN 全開，含 delete");
  assert.ok(canRitualRegistration("STAFF", "register") && !canRitualRegistration("READONLY", "register"));
  for (const a of ACTIVITY_MUTATIONS) assert.ok(!canActivity("READONLY", a), `READONLY 不可 ${a}`);
});

test("收款管理：STAFF 可收款/臨時應收；沖銷/退款/對帳 僅 ADMIN 以上；READONLY 只讀", () => {
  assert.ok(canCollection("STAFF", "recordPayment") && canCollection("STAFF", "manageManualReceivable"));
  for (const a of ["voidPayment", "refund", "reconcile"] as const) {
    assert.ok(!canCollection("STAFF", a), `STAFF 不可 ${a}`);
    assert.ok(canCollection("ADMIN", a) && canCollection("SUPER_ADMIN", a), `ADMIN/SUPER 可 ${a}`);
  }
  for (const a of COLLECTION_ALL) if (a !== "view") assert.ok(!canCollection("READONLY", a), `READONLY 不可 ${a}`);
});

test("財務中心（V38 收斂）：SUPER_ADMIN 完整；ADMIN 唯讀（view/報表/匯出）；STAFF/READONLY 全部 false", () => {
  const FIN = ["view", "viewFullReport", "create", "update", "void", "export", "createEntry", "transfer", "reconcile", "correct", "manageOpening"] as const;
  const ADMIN_READONLY = new Set(["view", "viewFullReport", "export"]);
  for (const a of FIN) assert.ok(canFinance("SUPER_ADMIN", a), `SUPER_ADMIN 可 ${a}`);
  for (const a of FIN) {
    // V38：ADMIN 只保留唯讀（查看/完整報表/匯出），寫入類（新增/修改/作廢/轉帳/盤點/更正/期初）一律 false。
    if (ADMIN_READONLY.has(a)) assert.ok(canFinance("ADMIN", a), `ADMIN 可（唯讀）${a}`);
    else assert.ok(!canFinance("ADMIN", a), `ADMIN 不可（唯讀）${a}`);
  }
  for (const a of FIN) {
    assert.ok(!canFinance("STAFF", a), `STAFF 不可 ${a}`);
    assert.ok(!canFinance("READONLY", a), `READONLY 不可 ${a}`);
  }
});

test("列印管理：查看/列印/補印 開放 SUPER/ADMIN/STAFF；READONLY 只可查看（列印會寫狀態）", () => {
  for (const r of ["SUPER_ADMIN", "ADMIN", "STAFF"] as const) {
    assert.ok(canUniversalSalvation(r, "print") && canUniversalSalvation(r, "reprint"), `${r} 可列印/補印`);
  }
  assert.ok(canUniversalSalvation("READONLY", "view") && !canUniversalSalvation("READONLY", "print"));
});

test("收據：STAFF 可開立/列印/補印/匯出，不可作廢/換開；作廢換開需核准（SUPER/ADMIN）；號碼規則僅 SUPER_ADMIN", () => {
  assert.ok(canReceipt("STAFF", "issue") && canReceipt("STAFF", "print") && canReceipt("STAFF", "exportData"));
  assert.ok(!canReceipt("STAFF", "void") && !canReceipt("STAFF", "reissue"));
  assert.ok(canApproveReceiptVoidOrReissue("SUPER_ADMIN") && canApproveReceiptVoidOrReissue("ADMIN"));
  assert.ok(!canApproveReceiptVoidOrReissue("STAFF") && !canApproveReceiptVoidOrReissue("READONLY"));
  assert.ok(canReceipt("SUPER_ADMIN", "manageNumbering") && canReceipt("ADMIN", "manageNumbering"));
});

test("系統管理（V40 ADMIN 純檢視/唯讀）：ADMIN 只可 viewSystemCenter，其餘動作只有 SUPER_ADMIN；STAFF/READONLY 全無", () => {
  // V40（Stella 定案，取代 V39）：管理者系統管理改「純檢視/唯讀」，只保留 viewSystemCenter；
  // 備份/還原/雲端/排程/匯入/使用者角色/回收桶/驗收掃描等會改資料或設定的動作一律移除。
  assert.ok(canSystem("ADMIN", "viewSystemCenter"), "ADMIN 可看系統管理（唯讀）");
  for (const a of SYSTEM_ALL) {
    assert.ok(canSystem("SUPER_ADMIN", a), `SUPER_ADMIN 可 ${a}`);
    if (a !== "viewSystemCenter") assert.ok(!canSystem("ADMIN", a), `ADMIN 不可 ${a}（唯讀）`);
  }
  for (const a of SYSTEM_ALL) assert.ok(!canSystem("STAFF", a) && !canSystem("READONLY", a), `STAFF/READONLY 不可 ${a}`);
});

test("模板（V39 ADMIN 全開）：ADMIN 與 SUPER_ADMIN 相同（含 seed／delete）；STAFF/READONLY 只讀", () => {
  for (const a of ["seed", "delete", "create", "update", "activate"] as const) assert.ok(canTemplate("SUPER_ADMIN", a) && canTemplate("ADMIN", a), `SUPER/ADMIN 皆可 ${a}`);
  assert.ok(canTemplate("STAFF", "view") && !canTemplate("STAFF", "create"));
});

test("不變式一：每個模組 SUPER_ADMIN ⊇ ADMIN（ADMIN 有的，SUPER_ADMIN 一定有）", () => {
  const checks: [readonly string[], (r: Role, a: string) => boolean][] = [
    [ACTIVITY_ALL, canActivity as (r: Role, a: string) => boolean],
    [COLLECTION_ALL, canCollection as (r: Role, a: string) => boolean],
    [FINANCE_ALL, canFinance as (r: Role, a: string) => boolean],
    [US_ALL, canUniversalSalvation as (r: Role, a: string) => boolean],
    [RECEIPT_ALL, canReceipt as (r: Role, a: string) => boolean],
    [SYSTEM_ALL, canSystem as (r: Role, a: string) => boolean],
    [TEMPLATE_ALL, canTemplate as (r: Role, a: string) => boolean],
  ];
  for (const [actions, can] of checks) {
    for (const a of actions) {
      if (can("ADMIN", a)) assert.ok(can("SUPER_ADMIN", a), `SUPER_ADMIN 應涵蓋 ADMIN 的 ${a}`);
    }
  }
});

test("不變式二：READONLY 對所有會寫入的動作一律為 false", () => {
  for (const a of ACTIVITY_MUTATIONS) assert.ok(!canActivity("READONLY", a));
  for (const a of ["recordPayment", "voidPayment", "refund", "reconcile", "manageManualReceivable"] as const) assert.ok(!canCollection("READONLY", a));
  for (const a of ["createEntry", "transfer", "reconcile", "void", "correct", "manageOpening"] as const) assert.ok(!canFinance("READONLY", a));
  for (const a of ["create", "update", "delete", "restore", "print", "reprint"] as const) assert.ok(!canUniversalSalvation("READONLY", a));
  for (const a of ["issue", "void", "reissue", "manageSettings", "manageNumbering"] as const) assert.ok(!canReceipt("READONLY", a));
  for (const a of SYSTEM_ALL) assert.ok(!canSystem("READONLY", a));
});
