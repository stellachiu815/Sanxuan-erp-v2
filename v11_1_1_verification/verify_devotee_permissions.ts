// V12.0 真實執行驗證：跟 verify_system_permissions.ts 同樣的方法論——
// src/lib/permissions.ts 不依賴任何外部套件（next/react/@prisma/client），
// 可以在沒有 npm install 的沙盒環境裡用 tsx 直接載入「真正的原始碼」執行，
// 不是憑空模擬。這支腳本針對 V12.0 新增的 DevoteeAction / canDevotee()
// 做真實執行驗證，對應交付報告「十六、權限」「二十一、18/19/20」。
import { canDevotee, type Role, type DevoteeAction } from "../src/lib/permissions";

let pass = 0;
let fail = 0;

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "PASS" : "FAIL"} - ${label} => actual=${JSON.stringify(actual)} expected=${JSON.stringify(expected)}`);
  if (ok) pass++;
  else fail++;
}

const ALL_ACTIONS: DevoteeAction[] = [
  "view",
  "viewFinancialSummary",
  "viewFullFinancialStats",
  "viewAuditLog",
  "createProfile",
  "updateProfile",
  "manageTags",
  "applyTag",
  "createInteraction",
  "manageInteractions",
  "manageCareList",
  "mergeDevotees",
];

// 指令「十六」逐句對照的期望矩陣。
const EXPECTED: Record<Role, DevoteeAction[]> = {
  SUPER_ADMIN: [
    "view",
    "viewFinancialSummary",
    "viewFullFinancialStats",
    "viewAuditLog",
    "createProfile",
    "updateProfile",
    "manageTags",
    "applyTag",
    "createInteraction",
    "manageInteractions",
    "manageCareList",
  ],
  ADMIN: ["view", "viewFinancialSummary", "updateProfile", "applyTag", "createInteraction"],
  STAFF: [],
  READONLY: ["view", "viewFinancialSummary"],
  FINANCE_CLERK: [],
};

for (const role of Object.keys(EXPECTED) as Role[]) {
  for (const action of ALL_ACTIONS) {
    const expected = EXPECTED[role].includes(action);
    check(`canDevotee(${role}, "${action}")`, canDevotee(role, action), expected);
  }
}

// 對應指令「二十一、18. READONLY 無法修改資料」：逐一確認 READONLY 對
// 所有「會改變資料」的動作一律是 false（view/viewFinancialSummary 以外）。
const mutatingActions: DevoteeAction[] = [
  "createProfile",
  "updateProfile",
  "manageTags",
  "applyTag",
  "createInteraction",
  "manageInteractions",
  "manageCareList",
];
for (const action of mutatingActions) {
  check(`READONLY 不得執行「${action}」（真實資料異動類操作）`, canDevotee("READONLY", action), false);
}

// 對應指令「二十一、19. ADMIN 無法管理敏感權限」：manageTags（標籤管理）／
// manageInteractions（互動紀錄管理）／manageCareList（關懷名單管理）／
// viewFullFinancialStats（完整捐款統計）／viewAuditLog（稽核紀錄）
// 這五項指令明確只給 SUPER_ADMIN，ADMIN 一律不得擁有。
const superAdminOnlyActions: DevoteeAction[] = [
  "manageTags",
  "manageInteractions",
  "manageCareList",
  "viewFullFinancialStats",
  "viewAuditLog",
];
for (const action of superAdminOnlyActions) {
  check(`ADMIN 不得擁有「${action}」（僅 SUPER_ADMIN 的敏感權限）`, canDevotee("ADMIN", action), false);
  check(`SUPER_ADMIN 必須擁有「${action}」`, canDevotee("SUPER_ADMIN", action), true);
}

// 對應指令「二十一、20. SUPER_ADMIN 可完成全部管理操作」。
for (const action of ALL_ACTIONS.filter((a) => a !== "mergeDevotees")) {
  check(`SUPER_ADMIN 必須擁有「${action}」（全部管理操作，合併功能本次未開放不計入）`, canDevotee("SUPER_ADMIN", action), true);
}

// 對應指令「十三」：合併功能本次不開放——沒有任何角色（包含 SUPER_ADMIN）
// 擁有 mergeDevotees，確認這不是漏寫，是刻意的設計。
for (const role of Object.keys(EXPECTED) as Role[]) {
  check(`「${role}」不得擁有 mergeDevotees（指令「十三」本次不開放合併功能）`, canDevotee(role, "mergeDevotees"), false);
}

// 邊界案例：未知角色字串不應該讓程式炸掉或意外回傳 true。
check(
  "未知角色字串應安全回傳 false（不會炸掉）",
  canDevotee("NOT_A_REAL_ROLE" as Role, "view"),
  false
);

console.log(`\n總結：${pass} 項通過，${fail} 項失敗。`);
if (fail > 0) process.exit(1);
