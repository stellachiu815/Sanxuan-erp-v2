import { test } from "node:test";
import assert from "node:assert/strict";
import { previewRouteForPrintObject } from "../src/lib/printPreviewRoutes";

/**
 * V21.1 正式列印預覽對照表——純函式驗證。
 * 每一種列印物件都必須對應「自己的正式列印模板」，不得導向管理頁、不得共用錯誤模板。
 */

test("牌位 TABLET → 家戶牌位 A4 正式列印頁", () => {
  const t = previewRouteForPrintObject({ itemKey: "US_ANCESTOR", contentKind: "TABLET", householdId: "F00009", year: 115 });
  assert.equal(t.href, "/household/F00009/rituals/universal-salvation/print");
  assert.equal(t.isRosterItself, false);
});

test("牌位無家戶時退回名冊頁（不落空）", () => {
  const t = previewRouteForPrintObject({ itemKey: "US_ANCESTOR", contentKind: "TABLET", householdId: null, year: 115 });
  assert.equal(t.href, "/print-center/rosters/US_ANCESTOR/115");
});

test("寶袋 POCKET → 牌位／寶袋列印物件中心（系統唯一寶袋版型處）", () => {
  const t = previewRouteForPrintObject({ itemKey: "US_POCKET_EXTRA", contentKind: "POCKET", householdId: "F1", year: 115 });
  assert.equal(t.href, "/universal-salvation/115/print-center");
  assert.equal(t.isRosterItself, false);
});

test("年度燈 LANTERN → 各燈別正式列印頁", () => {
  assert.equal(previewRouteForPrintObject({ itemKey: "LANTERN_GUANGMING", contentKind: "LANTERN", year: 115 }).href, "/lantern/GUANGMING_LANTERN/print");
  assert.equal(previewRouteForPrintObject({ itemKey: "LANTERN_TAISUI", contentKind: "LANTERN", year: 115 }).href, "/lantern/TAISUI_LANTERN/print");
  assert.equal(previewRouteForPrintObject({ itemKey: "LANTERN_FAMILY", contentKind: "LANTERN", year: 115 }).href, "/lantern/FAMILY_LANTERN/print");
});

test("祭改 PURIFICATION → 小人頭正式列印頁（沿用承載該年度祭改的 TempleEvent；不 fallback 名冊）", () => {
  const t = previewRouteForPrintObject({ itemKey: "LANTERN_PURIFICATION", contentKind: "PURIFICATION", templeEventId: "evt_annual_115", year: 115 });
  assert.equal(t.href, "/purification/evt_annual_115/print");
  assert.equal(t.isRosterItself, false);
  // 不得導向名冊或管理頁。
  assert.ok(!t.href.includes("/print-center/rosters/"), "祭改不得導向名冊頁");
  assert.ok(!/\/print-center$/.test(t.href), "祭改不得導向管理首頁");
});

test("白米 RICE / 贊普 SPONSOR / 名冊 → 名冊列印頁本身即正式版型", () => {
  const rice = previewRouteForPrintObject({ itemKey: "US_RICE", contentKind: "RICE", year: 115 });
  assert.equal(rice.href, "/print-center/rosters/US_RICE/115");
  assert.equal(rice.isRosterItself, true);
  const sponsor = previewRouteForPrintObject({ itemKey: "US_SPONSOR", contentKind: "SPONSOR", year: 115 });
  assert.equal(sponsor.href, "/print-center/rosters/US_SPONSOR/115");
  assert.equal(sponsor.isRosterItself, true);
});

test("任何型別都不得導向 /print-center 管理首頁", () => {
  for (const kind of ["TABLET", "POCKET", "LANTERN", "RICE", "SPONSOR", "ROSTER", "PETITION"]) {
    const t = previewRouteForPrintObject({ itemKey: "X", contentKind: kind, householdId: "F1", year: 115 });
    assert.notEqual(t.href, "/print-center");
    assert.ok(!/^\/print-center$/.test(t.href), `${kind} 不得指向管理首頁`);
  }
});
