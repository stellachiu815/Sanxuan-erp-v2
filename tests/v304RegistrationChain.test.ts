import { test } from "node:test";
import assert from "node:assert/strict";
import {
  universalSalvationItemDropdown,
  confirmedRecordHasLeftoverDrafts,
} from "../src/lib/registrationDisplayRules";

/** V30.4 報名資料鏈：下拉來源 + 確認補確認規則（純函式，涵蓋正式查詢路徑所用邏輯）。 */

const SUMMARY = [
  { itemKey: "US_ANCESTOR", itemName: "超拔祖先", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_ZHENGHUN", itemName: "乙位正魂", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_YUANQIN", itemName: "累世冤親債主", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_WUYUAN", itemName: "無緣子女", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_POCKET_EXTRA", itemName: "增加寶袋", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_RICE", itemName: "白米登記", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_SPONSOR", itemName: "贊普", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "US_SPONSOR_DONATION", itemName: "隨喜贊普", activityGroup: "UNIVERSAL_SALVATION" },
  { itemKey: "LANTERN_GUANGMING", itemName: "光明燈", activityGroup: "ANNUAL_LANTERN" },
];

test("下拉來源＝該活動啟用項目：含全部 8 項普渡項目，排除年度燈，最前面『全部項目』", () => {
  const opts = universalSalvationItemDropdown(SUMMARY);
  assert.equal(opts[0].key, "");
  assert.equal(opts[0].name, "全部項目");
  const keys = opts.slice(1).map((o) => o.key);
  assert.deepEqual(keys, [
    "US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN",
    "US_POCKET_EXTRA", "US_RICE", "US_SPONSOR", "US_SPONSOR_DONATION",
  ]);
  assert.ok(!keys.includes("LANTERN_GUANGMING"), "年度燈不在普渡下拉");
});

test("下拉 0 筆也保留：來源為啟用項目而非查到的名單，故某項目 0 筆仍在選單", () => {
  // summary 只反映啟用項目與名稱，不含筆數；即使實際 0 筆，選項仍在。
  const opts = universalSalvationItemDropdown(SUMMARY);
  assert.ok(opts.some((o) => o.key === "US_ZHENGHUN" && o.name === "乙位正魂"));
  assert.ok(opts.some((o) => o.key === "US_YUANQIN"));
  assert.ok(opts.some((o) => o.key === "US_WUYUAN"));
});

test("下拉用正式名稱，不新舊混用", () => {
  const opts = universalSalvationItemDropdown(SUMMARY);
  const byKey = new Map(opts.map((o) => [o.key, o.name]));
  assert.equal(byKey.get("US_YUANQIN"), "累世冤親債主");
  assert.equal(byKey.get("US_POCKET_EXTRA"), "增加寶袋");
});

test("已 CONFIRMED 但有 DRAFT item → 需補確認（確認後再加冤親的情境）", () => {
  assert.equal(confirmedRecordHasLeftoverDrafts("CONFIRMED", 3), true);
  assert.equal(confirmedRecordHasLeftoverDrafts("CONFIRMED", 1), true);
});

test("已 CONFIRMED 且無 DRAFT item → no-op（不重複處理）", () => {
  assert.equal(confirmedRecordHasLeftoverDrafts("CONFIRMED", 0), false);
});

test("非 CONFIRMED（DRAFT/CANCELLED）不走此補確認分支（由主流程處理）", () => {
  assert.equal(confirmedRecordHasLeftoverDrafts("DRAFT", 5), false);
  assert.equal(confirmedRecordHasLeftoverDrafts("CANCELLED", 5), false);
});
