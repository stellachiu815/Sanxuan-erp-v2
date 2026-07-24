import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canSystem,
  canTemplate,
  canCollection,
  canPurification,
  canOffering,
  canDevotee,
  canApproveReceiptVoidOrReissue,
  type Role,
} from "../src/lib/permissions";

/**
 * V14.3【前端角色顯示與操作收斂】前端閘門測試。
 *
 * 這裡驗證「前端各處實際使用的 canX 判斷」在四種角色下的顯示/隱藏結果，
 * 對應指令「九、前端角色測試」。前端閘門一律沿用這些 permissions.ts 函式
 * （單一來源），因此測到 canX 就等於測到前端 <Can>／PermissionGate／
 * requirePagePermission 的實際行為。
 */

// 首頁選單（page.tsx）
const homeShowImport = (r: Role) => canSystem(r, "manageDataImport");
const homeShowRecycleBin = (r: Role) => canSystem(r, "manageRecycleBin");
const homeShowSystemCenter = (r: Role) =>
  canSystem(r, "viewSystemCenter") ||
  canSystem(r, "manageUsers") ||
  canSystem(r, "manageDataImport") ||
  canSystem(r, "manageRecycleBin");

test("SUPER_ADMIN：看得到全部管理入口", () => {
  const r: Role = "SUPER_ADMIN";
  assert.equal(homeShowImport(r), true);
  assert.equal(homeShowRecycleBin(r), true);
  assert.equal(homeShowSystemCenter(r), true);
  assert.equal(canSystem(r, "manageUsers"), true); // 使用者管理
  assert.equal(canSystem(r, "restoreBackup"), true); // 備份還原
  assert.equal(canTemplate(r, "seed"), true); // 模板 seed
  assert.equal(canSystem(r, "purgeRecycleBin"), true); // 永久刪除
});

test("ADMIN：看不到使用者管理／備份還原／seed／僅 SUPER 的永久刪除", () => {
  const r: Role = "ADMIN";
  // 看得到：匯入、回收區（還原）、系統管理入口、日常模組管理
  assert.equal(homeShowImport(r), true);
  assert.equal(homeShowRecycleBin(r), true);
  assert.equal(homeShowSystemCenter(r), true);
  assert.equal(canTemplate(r, "create"), true);
  assert.equal(canCollection(r, "voidPayment"), true);
  // 看不到：
  assert.equal(canSystem(r, "manageUsers"), false); // 使用者管理
  assert.equal(canSystem(r, "restoreBackup"), false); // 備份還原
  assert.equal(canSystem(r, "viewSystemCenter"), false); // 備份/還原/GoogleDrive 主選單
  assert.equal(canTemplate(r, "seed"), false); // 模板 seed
  assert.equal(canSystem(r, "purgeRecycleBin"), false); // 永久刪除（僅 SUPER）
});

test("STAFF：日常操作可；使用者管理／匯入／核心設定／永久刪除／備份還原／模板管理不可", () => {
  const r: Role = "STAFF";
  // 日常操作
  assert.equal(canCollection(r, "recordPayment"), true); // 收款
  assert.equal(canPurification(r, "create"), true); // 祭改報名
  assert.equal(canPurification(r, "print"), true); // 列印
  assert.equal(canDevotee(r, "updateProfile"), true); // 新增/修改信眾、活動報名入口
  // 不可
  assert.equal(homeShowImport(r), false); // 匯入入口
  assert.equal(homeShowRecycleBin(r), false); // 回收區
  assert.equal(homeShowSystemCenter(r), false); // 系統管理入口
  assert.equal(canSystem(r, "manageUsers"), false);
  assert.equal(canPurification(r, "manageYears"), false); // 年度核心設定
  assert.equal(canPurification(r, "manageBannedNumbers"), false); // 禁用號碼
  assert.equal(canOffering(r, "manageOfferingTypes"), false); // 供品種類設定
  assert.equal(canCollection(r, "voidPayment"), false); // 作廢
  assert.equal(canCollection(r, "refund"), false); // 退款
  assert.equal(canTemplate(r, "create"), false); // 模板建立
  assert.equal(canTemplate(r, "activate"), false); // 模板啟用
  assert.equal(canDevotee(r, "transferMember"), false); // 家戶結構編輯
});

test("READONLY：只讀，所有寫入閘門一律關閉", () => {
  const r: Role = "READONLY";
  assert.equal(canCollection(r, "recordPayment"), false);
  assert.equal(canCollection(r, "voidPayment"), false);
  assert.equal(canCollection(r, "refund"), false);
  assert.equal(canPurification(r, "create"), false);
  assert.equal(canPurification(r, "print"), false); // 會寫入列印紀錄
  assert.equal(canPurification(r, "reprint"), false);
  assert.equal(canPurification(r, "manageYears"), false);
  assert.equal(canOffering(r, "manageOfferingTypes"), false);
  assert.equal(canTemplate(r, "create"), false);
  assert.equal(canTemplate(r, "activate"), false);
  assert.equal(canDevotee(r, "updateProfile"), false);
  assert.equal(canDevotee(r, "transferMember"), false);
  assert.equal(homeShowImport(r), false);
  assert.equal(homeShowRecycleBin(r), false);
  assert.equal(homeShowSystemCenter(r), false);
  // 只讀允許：查看
  assert.equal(canDevotee(r, "view"), true);
  assert.equal(canPurification(r, "view"), true);
  assert.equal(canTemplate(r, "view"), true);
});

test("收據作廢／換開核准人：僅 SUPER_ADMIN／ADMIN 進入候選", () => {
  assert.equal(canApproveReceiptVoidOrReissue("SUPER_ADMIN"), true);
  assert.equal(canApproveReceiptVoidOrReissue("ADMIN"), true);
  assert.equal(canApproveReceiptVoidOrReissue("STAFF"), false);
  assert.equal(canApproveReceiptVoidOrReissue("READONLY"), false);
});
