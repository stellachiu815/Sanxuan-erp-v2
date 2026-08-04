import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V36.5：Excel 額外寶袋在 CREATE／UPDATE／SKIP 三路徑皆建立、且冪等（靜態驗證正式程式碼）。
 * 匯入確認為 DB 交易流程，沙盒無法連 DB；此處守住程式碼層護欄。
 */
const src = readFileSync(new URL("../src/lib/purificationImport.ts", import.meta.url), "utf8");

test("有冪等 helper ensureImportExtraPocket，且以既有額外寶袋做冪等守門", () => {
  assert.ok(src.includes("async function ensureImportExtraPocket"), "需有 ensureImportExtraPocket helper");
  // 冪等：查既有 isExtra=true 額外寶袋，>0 則不重複建立（姓名模式 continue、數量模式 return created:0）。
  assert.ok(/isExtra:\s*true/.test(src));
  const flat = src.replace(/\s+/g, " ");
  assert.ok(/exists\s*>\s*0\s*\)\s*continue/.test(flat), "姓名模式：同牌位+同姓名已存在→略過");
  assert.ok(/exists\s*>\s*0\s*\)\s*return\s*\{\s*created:\s*0/.test(flat), "數量模式：已有沿用名額外寶袋→不重複");
});

test("CREATE／UPDATE／SKIP 三路徑都呼叫 ensureImportExtraPocket", () => {
  const calls = (src.match(/ensureImportExtraPocket\(/g) ?? []).length;
  // 1 個定義 + 3 個呼叫（CREATE／UPDATE／SKIP）。
  assert.ok(calls >= 4, `ensureImportExtraPocket 應被三路徑呼叫（含定義共 >=4 次），實際 ${calls}`);
  // SKIP 分支：已存在牌位也建額外寶袋。
  assert.ok(/action === "SKIP"[\s\S]*?ensureImportExtraPocket/.test(src), "SKIP 路徑需建額外寶袋");
  // UPDATE 分支：更新既有牌位也建額外寶袋。
  assert.ok(/action === "UPDATE"[\s\S]*?ensureImportExtraPocket/.test(src), "UPDATE 路徑需建額外寶袋");
});

test("額外寶袋沿用 isExtra=true、isChargeable=true（與 CREATE 一致，不另創財務規則）", () => {
  assert.ok(/itemType:\s*"POCKET",\s*usesSourceName:\s*true,\s*quantity:[^,]+,\s*isExtra:\s*true,\s*isChargeable:\s*true/.test(src), "額外寶袋維持與 CREATE 一致的建立參數");
});

test("基本寶袋仍由 ensureTabletPrintObjects 建立（不因額外寶袋改動）", () => {
  const api = readFileSync(new URL("../src/lib/additionalPrintItems.ts", import.meta.url), "utf8");
  assert.ok(api.includes("export async function ensureTabletPrintObjects"), "基本 TABLET／POCKET 仍由 ensureTabletPrintObjects 建立");
});
