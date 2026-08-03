import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeByCategory, type DetailCategoryRow } from "../src/lib/registrationDetailShape";

/** V31 §3 信眾活動摘要：只計有效；牌位筆數、白米斤數、基本/額外寶袋分開；DRAFT/CANCELLED 另 Badge。 */

const rows: DetailCategoryRow[] = [
  { kind: "TABLET", itemName: "超拔祖先", section: "ACTIVE", quantity: 1, pocketKind: null },
  { kind: "TABLET", itemName: "乙位正魂", section: "ACTIVE", quantity: 1, pocketKind: null },
  { kind: "TABLET", itemName: "累世冤親債主", section: "ACTIVE", quantity: 1, pocketKind: null },
  ...Array.from({ length: 7 }, () => ({ kind: "TABLET", itemName: "累世冤親債主", section: "ACTIVE" as const, quantity: 1, pocketKind: null })),
  { kind: "TABLET", itemName: "無緣子女", section: "ACTIVE", quantity: 1, pocketKind: null },
  { kind: "RICE", itemName: "白米登記", section: "ACTIVE", quantity: 30, pocketKind: null },
  ...Array.from({ length: 11 }, () => ({ kind: "POCKET", itemName: "基本寶袋", section: "ACTIVE" as const, quantity: 1, pocketKind: "BASIC" as const })),
  { kind: "POCKET", itemName: "增加寶袋", section: "ACTIVE", quantity: 1, pocketKind: "EXTRA" },
  { kind: "POCKET", itemName: "增加寶袋", section: "ACTIVE", quantity: 1, pocketKind: "EXTRA" },
  { kind: "SPONSOR", itemName: "贊普", section: "ACTIVE", quantity: 1, pocketKind: null },
  // 不得計入有效摘要：
  { kind: "TABLET", itemName: "超拔祖先", section: "DRAFT", quantity: 1, pocketKind: null },
  { kind: "TABLET", itemName: "乙位正魂", section: "CANCELLED", quantity: 1, pocketKind: null },
];

test("摘要：牌位顯示筆數（非 quantity 加總）、白米斤數、基本/額外寶袋分開", () => {
  const s = summarizeByCategory(rows);
  const t = new Map(s.tablets.map((x) => [x.itemName, x.count]));
  assert.equal(t.get("超拔祖先"), 1, "DRAFT 祖先不計入有效");
  assert.equal(t.get("乙位正魂"), 1, "CANCELLED 乙位不計入有效");
  assert.equal(t.get("累世冤親債主"), 8);
  assert.equal(t.get("無緣子女"), 1);
  assert.equal(s.riceKg, 30, "白米顯示總斤數");
  assert.equal(s.basicPocket, 11);
  assert.equal(s.extraPocket, 2);
  assert.equal(s.sponsors[0].count, 1);
});

test("DRAFT/CANCELLED 另計 Badge，不混入有效摘要", () => {
  const s = summarizeByCategory(rows);
  assert.equal(s.draftCount, 1);
  assert.equal(s.cancelledCount, 1);
});

test("地基主歸類無緣子女：itemName 仍為報名項目正式名稱（printMainText 不改分類）", () => {
  // 地基主是「單筆列印主文覆寫」，itemName（registrationItemType.name）仍是無緣子女。
  const s = summarizeByCategory([
    { kind: "TABLET", itemName: "無緣子女", section: "ACTIVE", quantity: 1, pocketKind: null },
  ]);
  assert.equal(s.tablets[0].itemName, "無緣子女", "分類不因列印主文覆寫而改變");
});
