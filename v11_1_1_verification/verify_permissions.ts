// V11.1.1 真實執行驗證：src/lib/permissions.ts 是本專案少數「不依賴任何
// 外部套件（next/react/@prisma/client）」的純函式檔案，因此可以在沒有
// npm install 的沙盒環境裡，用 tsx 直接載入「真正的原始碼」執行，
// 不是憑空模擬——這是本輪唯一能對「權限矩陣程式碼本身」做到真實執行測試
// 的部分（其餘依賴 Prisma 的部分，例如 resolveOperator()，因為
// @prisma/client 沒有安裝，無法在這個沙盒裡真的執行，只能用程式碼審查
// ＋既有的 SQL 層驗證來佐證，詳見交付報告）。
import {
  canReceipt,
  canApproveReceiptVoidOrReissue,
  type Role,
  type ReceiptAction,
} from "../src/lib/permissions";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label} => actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (ok) pass++;
  else fail++;
}

const roles: Role[] = ["SUPER_ADMIN", "ADMIN", "STAFF", "READONLY", "FINANCE_CLERK"];
const actions: ReceiptAction[] = [
  "view",
  "issue",
  "markNoReceiptRequired",
  "print",
  "reprint",
  "void",
  "reissue",
  "manageSettings",
  "manageNumbering",
  "exportData",
  "viewAuditLog",
];

console.log("=== 完整權限矩陣（角色 x 動作）真實執行結果 ===");
for (const role of roles) {
  const allowed = actions.filter((a) => canReceipt(role, a));
  console.log(`${role}: ${allowed.join(", ") || "(無)"}`);
}

console.log("\n=== 指令「二」明確場景驗證 ===");
// 場景一：一般工作人員嘗試「作廢收據」，必須被拒絕
check("STAFF 嘗試作廢收據應被拒絕", canReceipt("STAFF", "void"), false);
// 場景二：一般工作人員嘗試「換開收據」，必須被拒絕
check("STAFF 嘗試換開收據應被拒絕", canReceipt("STAFF", "reissue"), false);
// 場景三：唯讀人員嘗試「開立收據」，必須被拒絕
check("READONLY 嘗試開立收據應被拒絕", canReceipt("READONLY", "issue"), false);
// 場景四：唯讀人員嘗試「標記不需開立」，必須被拒絕
check("READONLY 嘗試標記不需開立應被拒絕", canReceipt("READONLY", "markNoReceiptRequired"), false);
// 場景五（指令「二」：只有最高管理員可以修改流水號規則）
check("SUPER_ADMIN 可以管理收據號碼規則", canReceipt("SUPER_ADMIN", "manageNumbering"), true);
check("ADMIN 不可以管理收據號碼規則（僅 SUPER_ADMIN）", canReceipt("ADMIN", "manageNumbering"), false);
check("STAFF 不可以管理收據號碼規則", canReceipt("STAFF", "manageNumbering"), false);
check("READONLY 不可以管理收據號碼規則", canReceipt("READONLY", "manageNumbering"), false);
check("FINANCE_CLERK 不可以管理收據號碼規則", canReceipt("FINANCE_CLERK", "manageNumbering"), false);
// 場景六（指令「二」：只有授權管理人員可以作廢/換開）
check("SUPER_ADMIN 可以作廢收據", canReceipt("SUPER_ADMIN", "void"), true);
check("ADMIN 可以作廢收據", canReceipt("ADMIN", "void"), true);
check("SUPER_ADMIN 可以換開收據", canReceipt("SUPER_ADMIN", "reissue"), true);
check("ADMIN 可以換開收據", canReceipt("ADMIN", "reissue"), true);
check("STAFF 不可以作廢收據", canReceipt("STAFF", "void"), false);
check("FINANCE_CLERK 完全沒有任何收據權限", actions.some((a) => canReceipt("FINANCE_CLERK", a)), false);

console.log("\n=== 指令「四」核准人資格驗證（canApproveReceiptVoidOrReissue） ===");
check("SUPER_ADMIN 可擔任核准人", canApproveReceiptVoidOrReissue("SUPER_ADMIN"), true);
check("ADMIN 可擔任核准人", canApproveReceiptVoidOrReissue("ADMIN"), true);
check("STAFF 不可擔任核准人", canApproveReceiptVoidOrReissue("STAFF"), false);
check("READONLY 不可擔任核准人", canApproveReceiptVoidOrReissue("READONLY"), false);
check("FINANCE_CLERK 不可擔任核准人", canApproveReceiptVoidOrReissue("FINANCE_CLERK"), false);

console.log(`\n=== 結果：${pass} 通過 / ${fail} 失敗（共 ${pass + fail} 項真實執行的斷言） ===`);
if (fail > 0) process.exit(1);

console.log("\n=== V11.2 getFullPermissionSnapshot() 真實執行測試 ===");
import("../src/lib/permissions").then(async (mod) => {
  const snapshot = mod.getFullPermissionSnapshot();
  console.log(JSON.stringify(snapshot, null, 2).slice(0, 2000));
  console.log("PASS - getFullPermissionSnapshot() 執行成功，回傳物件包含 keys:", Object.keys(snapshot).join(", "));
});
