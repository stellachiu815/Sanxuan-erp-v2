import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * V39 第二批：年度燈燈牌 mm 正式列印接入列印中心——結構驗證（沙盒可執行）。
 * 守住兩個根因修正：年度以 ANNUAL_LANTERN 解析、頁面有操作人員選擇器、
 * 列印中心年度燈入口有燈牌 mm 版型連結。
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

test("年度燈列印頁：年度以 ANNUAL_LANTERN 解析（修子類型查無的死結）", () => {
  const page = read("src/app/lantern/[activityType]/print/page.tsx");
  assert.ok(
    page.includes('listActivityYearCandidates("ANNUAL_LANTERN")'),
    "年度一律以承載年度燈的單一 ANNUAL_LANTERN 事件解析"
  );
  // 不再用子類型（activityType）去查活動年度。
  assert.ok(
    !/listActivityYearCandidates\(activityType/.test(page),
    "不得再用子類型查活動年度"
  );
});

test("年度燈列印頁：有操作人員選擇器，且可由網址帶年度", () => {
  const page = read("src/app/lantern/[activityType]/print/page.tsx");
  assert.ok(page.includes("OperatorBar"), "頁面有操作人員選擇器");
  assert.ok(page.includes("LanternPrintCenterWithOperator"), "改由 useOperator() 取得操作人員");
  assert.ok(page.includes("searchParams") && page.includes("year"), "可由 ?year= 指定年度");
});

test("列印中心年度燈入口：有燈牌 mm 版型連結（光明燈牌／太歲燈牌）", () => {
  const page = read("src/app/print-center/page.tsx");
  assert.ok(page.includes("/lantern/GUANGMING_LANTERN/print"), "光明燈牌列印入口");
  assert.ok(page.includes("/lantern/TAISUI_LANTERN/print"), "太歲燈牌列印入口");
  assert.ok(page.includes("光明燈牌列印"), "顯示光明燈牌列印按鈕");
});
