// V11.2 真實執行驗證：跟 verify_permissions.ts 同樣的方法論——
// src/lib/permissions.ts 不依賴任何外部套件（next/react/@prisma/client），
// 可以在沒有 npm install 的沙盒環境裡用 tsx 直接載入「真正的原始碼」執行，
// 不是憑空模擬。這支腳本針對 V11.2 新增的 SystemAction / canSystem()
// 做真實執行驗證，對應交付報告「十五、實際測試」第 14 項
// 「未授權操作被拒絕」的邏輯層證據（API 層的 403 回應則因為依賴
// @prisma/client／Next.js，無法在此沙盒實際呼叫，見交付報告）。
import { canSystem, type Role, type SystemAction } from "../src/lib/permissions";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label} => actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (ok) pass++;
  else fail++;
}

const roles: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY", "FINANCE_CLERK"];
const actions: SystemAction[] = [
  "viewSystemCenter",
  "runBackup",
  "downloadBackup",
  "restoreBackup",
  "manageGoogleDriveConnection",
  "manageBackupSchedule",
];

// 需求「十四」：只有 SUPER_ADMIN 可以做任何一件系統管理的事，
// 其餘四種角色（含 ADMIN）對每一個動作都必須是 false。
for (const role of roles) {
  for (const action of actions) {
    const expected = role === "SUPER_ADMIN";
    check(`canSystem(${role}, "${action}")`, canSystem(role, action), expected);
  }
}

// 額外邊界案例：角色字串打錯／未知角色，不應該讓程式炸掉或意外回傳 true。
check(
  'canSystem("NOT_A_REAL_ROLE" as Role, "viewSystemCenter") 不應為 true',
  canSystem("NOT_A_REAL_ROLE" as Role, "viewSystemCenter"),
  false
);

console.log(`\n共 ${pass + fail} 項斷言，通過 ${pass} 項，失敗 ${fail} 項。`);
if (fail > 0) process.exit(1);
