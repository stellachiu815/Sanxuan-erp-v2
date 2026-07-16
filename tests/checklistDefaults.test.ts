import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultChecklistLabels } from "../src/lib/checklistDefaults";

test("defaultChecklistLabels：祭改有專屬的『列印小人頭貼紙』項目", () => {
  const labels = defaultChecklistLabels("PURIFICATION");
  assert.ok(labels.includes("列印小人頭貼紙"));
  assert.ok(labels.includes("活動結案"));
});

test("defaultChecklistLabels：普渡有四大類登記確認項目", () => {
  const labels = defaultChecklistLabels("UNIVERSAL_SALVATION");
  assert.ok(labels.some((l) => l.includes("歷代祖先")));
  assert.ok(labels.some((l) => l.includes("功德名錄")));
});

test("defaultChecklistLabels：還沒有專屬規格的活動類型（光明燈/太歲燈/全家燈/補庫/其他）都回傳同一組通用清單", () => {
  const types = ["GUANGMING_LANTERN", "TAISUI_LANTERN", "FAMILY_LANTERN", "STORAGE_REPAYMENT", "OTHER"] as const;
  const first = defaultChecklistLabels(types[0]);
  for (const t of types) {
    assert.deepEqual(defaultChecklistLabels(t), first);
  }
  assert.ok(first.includes("活動結案"));
});

// V10.1「供品認捐中心」新增：宮慶／四位主祀神明聖誕，改用有供品認捐/爐主
// 副爐主待辦項目的專屬清單，不再跟光明燈/太歲燈等完全通用的清單相同。
test("defaultChecklistLabels：宮慶／四位主祀神明聖誕，都有供品認捐與爐主/副爐主待辦項目，彼此清單相同", () => {
  const types = [
    "TEMPLE_CELEBRATION",
    "GUANDI_BIRTHDAY",
    "XUANTIAN_BIRTHDAY",
    "YAOCHI_BIRTHDAY",
    "ZHONGTAN_BIRTHDAY",
  ] as const;
  const first = defaultChecklistLabels(types[0]);
  for (const t of types) {
    assert.deepEqual(defaultChecklistLabels(t), first);
  }
  assert.ok(first.some((l) => l.includes("供品認捐設定")));
  assert.ok(first.some((l) => l.includes("爐主")));
  assert.ok(first.includes("活動結案"));
});

test("defaultChecklistLabels：宮慶的供品清單跟光明燈等純通用清單不同（有供品/爐主相關項目）", () => {
  const templeCelebration = defaultChecklistLabels("TEMPLE_CELEBRATION");
  const generic = defaultChecklistLabels("GUANGMING_LANTERN");
  assert.notDeepEqual(templeCelebration, generic);
});

test("defaultChecklistLabels：每一種活動類型都一定有『活動結案』作為最後一步", () => {
  const allTypes = [
    "PURIFICATION",
    "UNIVERSAL_SALVATION",
    "GUANGMING_LANTERN",
    "TAISUI_LANTERN",
    "FAMILY_LANTERN",
    "STORAGE_REPAYMENT",
    "TEMPLE_CELEBRATION",
    "GUANDI_BIRTHDAY",
    "XUANTIAN_BIRTHDAY",
    "YAOCHI_BIRTHDAY",
    "ZHONGTAN_BIRTHDAY",
    "OTHER",
  ] as const;
  for (const t of allTypes) {
    const labels = defaultChecklistLabels(t);
    assert.equal(labels[labels.length - 1], "活動結案");
  }
});
