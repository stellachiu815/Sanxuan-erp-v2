import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseExtraPocketField } from "../src/lib/purificationImportRules";

/** V36.5B：額外寶袋「姓名／數量」欄位解析與正式流程（純函式＋靜態驗證）。 */

test("純數字 → 數量模式（江士耀=否，2→count2）", () => {
  assert.deepEqual(parseExtraPocketField("2"), { count: 2, names: [] });
  assert.deepEqual(parseExtraPocketField(" 3 "), { count: 3, names: [] });
});

test("單一姓名『江士耀』→ 建 1 個額外寶袋、保留姓名", () => {
  assert.deepEqual(parseExtraPocketField("江士耀"), { count: 1, names: ["江士耀"] });
});

test("多姓名（逗號／頓號／換行）→ 各自一筆", () => {
  assert.deepEqual(parseExtraPocketField("江士耀、王大明"), { count: 2, names: ["江士耀", "王大明"] });
  assert.deepEqual(parseExtraPocketField("甲,乙,丙"), { count: 3, names: ["甲", "乙", "丙"] });
  assert.deepEqual(parseExtraPocketField("甲\n乙"), { count: 2, names: ["甲", "乙"] });
});

test("空白 → 不建立", () => {
  assert.deepEqual(parseExtraPocketField(""), { count: 0, names: [] });
  assert.deepEqual(parseExtraPocketField(null), { count: 0, names: [] });
});

test("confirm：姓名模式每名各建 1 筆、usesSourceName=false、customPrintName=姓名，且同名冪等", () => {
  const src = readFileSync(new URL("../src/lib/purificationImport.ts", import.meta.url), "utf8");
  assert.ok(src.includes("usesSourceName: false"), "姓名模式需 usesSourceName=false（用自訂姓名）");
  assert.ok(src.includes("customPrintName: name"), "以姓名作為列印名稱");
  assert.ok(/isExtra:\s*true,\s*printName:\s*name/.test(src) || /printName:\s*name/.test(src), "冪等以 (牌位+姓名) 判斷");
  // CREATE/UPDATE/SKIP 都傳 names。
  assert.ok((src.match(/names:\s*edited\.extraPocketNames/g) ?? []).length >= 3, "三路徑都傳入額外寶袋姓名");
});

test("列印：額外寶袋填姓名時印該姓名，不沿用牌位主文（toRecord POCKET 用 printName）", () => {
  const src = readFileSync(new URL("../src/lib/TabletBatchService.ts", import.meta.url), "utf8");
  assert.ok(/itemType === "POCKET" && i\.usesSourceName === false/.test(src), "POCKET 且 usesSourceName=false → 用自身 printName");
  assert.ok(src.includes("pocketOwnName"), "額外寶袋自訂姓名優先於牌位主文");
});
