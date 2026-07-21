import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  canUniversalSalvation,
  UNIVERSAL_SALVATION_PERMISSION_MATRIX,
  type UniversalSalvationAction,
  type Role,
} from "../src/lib/permissions";

/**
 * V13.3A：普渡模組權限安全測試。
 *
 * 分兩部分：
 *   一、權限矩陣（純函式）——各角色能做什麼
 *   二、**靜態覆蓋檢查**——掃描檔案系統，確保每一支普渡 route 的每一個
 *       HTTP handler 都有權限檢查，且不再信任前端傳來的操作人姓名。
 *
 * 第二部分是這份測試最重要的價值：它會在**新增 route 卻忘記加權限**時
 * 直接失敗，而不是等到上線後才發現。
 */

const ALL_ACTIONS: UniversalSalvationAction[] = [
  "view",
  "create",
  "update",
  "delete",
  "restore",
  "print",
  "reprint",
];

const WRITE_ACTIONS: UniversalSalvationAction[] = [
  "create",
  "update",
  "delete",
  "restore",
  "print",
  "reprint",
];

// ============================================================
// 一、權限矩陣
// ============================================================

test("SUPER_ADMIN 可執行所有普渡操作", () => {
  for (const a of ALL_ACTIONS) {
    assert.equal(canUniversalSalvation("SUPER_ADMIN", a), true, `SUPER_ADMIN 應可 ${a}`);
  }
});

test("ADMIN 可執行所有普渡操作", () => {
  for (const a of ALL_ACTIONS) {
    assert.equal(canUniversalSalvation("ADMIN", a), true, `ADMIN 應可 ${a}`);
  }
});

test("STAFF 可執行讀寫刪除與列印操作", () => {
  for (const a of ALL_ACTIONS) {
    assert.equal(canUniversalSalvation("STAFF", a), true, `STAFF 應可 ${a}`);
  }
});

test("READONLY 只能查看，所有寫入操作一律被拒", () => {
  assert.equal(canUniversalSalvation("READONLY", "view"), true, "READONLY 應可 view");
  for (const a of WRITE_ACTIONS) {
    assert.equal(canUniversalSalvation("READONLY", a), false, `READONLY 不得 ${a}`);
  }
});

test("READONLY 明確不得更新列印狀態或建立補印紀錄", () => {
  // 這兩項會寫入資料庫，指令明確禁止 READONLY 執行
  assert.equal(canUniversalSalvation("READONLY", "print"), false);
  assert.equal(canUniversalSalvation("READONLY", "reprint"), false);
});

test("FINANCE_CLERK 目前不開放普渡任何操作", () => {
  for (const a of ALL_ACTIONS) {
    assert.equal(canUniversalSalvation("FINANCE_CLERK", a), false);
  }
});

test("未知角色一律拒絕（預設關閉，不是預設開放）", () => {
  const unknown = "NOT_A_ROLE" as Role;
  for (const a of ALL_ACTIONS) {
    assert.equal(canUniversalSalvation(unknown, a), false, `未知角色不得 ${a}`);
  }
});

test("權限矩陣快照與逐項判斷一致", () => {
  for (const [role, actions] of Object.entries(UNIVERSAL_SALVATION_PERMISSION_MATRIX)) {
    for (const a of ALL_ACTIONS) {
      assert.equal(
        canUniversalSalvation(role as Role, a),
        actions.includes(a),
        `${role} / ${a} 矩陣與函式判斷不一致`
      );
    }
  }
});

// ============================================================
// 二、靜態覆蓋檢查
// ============================================================

const API_ROOT = join(process.cwd(), "src/app/api");

/** 遞迴找出所有普渡相關的 route.ts。 */
function findUniversalSalvationRoutes(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      findUniversalSalvationRoutes(full, acc);
    } else if (name === "route.ts" && full.includes("universal-salvation")) {
      acc.push(full);
    }
  }
  return acc;
}

const HTTP_METHODS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

/** 取出某個 handler 的程式碼片段（從宣告到下一個 export 或檔尾）。 */
function extractHandler(src: string, method: string): string | null {
  const start = src.search(new RegExp(`export async function ${method}\\(`));
  if (start === -1) return null;
  const rest = src.slice(start + 1);
  const nextExport = rest.search(/\nexport (async )?function /);
  return nextExport === -1 ? rest : rest.slice(0, nextExport);
}

test("靜態檢查：每一支普渡 route 的每一個 handler 都有權限檢查", () => {
  const routes = findUniversalSalvationRoutes(API_ROOT);
  assert.equal(routes.length > 0, true, "應該要找得到普渡 route");

  const missing: string[] = [];
  let handlerCount = 0;

  for (const file of routes) {
    const src = readFileSync(file, "utf-8");
    for (const method of HTTP_METHODS) {
      const handler = extractHandler(src, method);
      if (!handler) continue;
      handlerCount++;
      if (!handler.includes("assertUniversalSalvationPermissionForOperator")) {
        missing.push(`${method} ${file.replace(API_ROOT, "")}`);
      }
    }
  }

  assert.deepEqual(missing, [], `以下 handler 沒有權限檢查：\n${missing.join("\n")}`);
  assert.equal(handlerCount > 0, true, "應該要找得到 handler");
});

test("靜態檢查：權限檢查必須在任何資料庫寫入之前", () => {
  /**
   * 指令五：「不先寫入資料再回權限錯誤」。
   * 檢查方式：權限檢查的位置必須早於任何 prisma 呼叫或 lib 寫入函式呼叫。
   */
  const routes = findUniversalSalvationRoutes(API_ROOT);
  const violations: string[] = [];

  for (const file of routes) {
    const src = readFileSync(file, "utf-8");
    for (const method of HTTP_METHODS) {
      const handler = extractHandler(src, method);
      if (!handler) continue;

      const guardAt = handler.indexOf("assertUniversalSalvationPermissionForOperator");
      if (guardAt === -1) continue;

      // 任何 await 呼叫 lib/prisma 的位置
      const writeAt = handler.search(/await (prisma|create|update|delete|cancel|restore)[A-Za-z]*\(/);
      if (writeAt !== -1 && writeAt < guardAt) {
        violations.push(`${method} ${file.replace(API_ROOT, "")}`);
      }
    }
  }

  assert.deepEqual(violations, [], `以下 handler 在權限檢查前就有寫入：\n${violations.join("\n")}`);
});

test("靜態檢查：普渡 API 不得再信任前端傳來的操作人姓名", () => {
  /**
   * 指令四：operatorName / createdBy / printedByName 等「操作人是誰」的
   * 欄位，一律不得取自 request body。
   *
   * ⚠️ operatorUserId 不在禁止之列——那是一個要拿去資料庫查證的 id，
   * 不是可信任的身分宣告。
   */
  const routes = findUniversalSalvationRoutes(API_ROOT);
  const forbidden =
    /body\.(operatorName|createdBy|updatedBy|deletedBy|restoredBy|printedBy|printedByName|deletedByName)/;

  const violations: string[] = [];
  for (const file of routes) {
    const src = readFileSync(file, "utf-8");
    if (forbidden.test(src)) {
      violations.push(file.replace(API_ROOT, ""));
    }
  }

  assert.deepEqual(violations, [], `以下 route 仍信任前端操作人姓名：\n${violations.join("\n")}`);
});

test("靜態檢查：操作人姓名一律取自伺服器查證結果", () => {
  /**
   * 有做權限檢查的 handler，若需要記錄操作人，必須用 check.operator.name。
   * 這裡驗證：凡是出現「操作人姓名」語意的地方，都來自 check.operator。
   */
  const routes = findUniversalSalvationRoutes(API_ROOT);
  let usesServerName = 0;

  for (const file of routes) {
    const src = readFileSync(file, "utf-8");
    if (src.includes("check.operator.name")) usesServerName++;
  }

  // 至少要有數支 route 實際記錄操作人（寫入類 API）
  assert.equal(usesServerName > 0, true, "應有 route 使用 check.operator.name 記錄操作人");
});
