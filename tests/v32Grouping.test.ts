import { test } from "node:test";
import assert from "node:assert/strict";
import { groupRowsForDisplay } from "../src/lib/registrationDetailShape";
import { computePacking, paginate } from "../src/components/ritual/tablets/packing";

/** V32 §10 寶袋群組 + §18 A4 packing。 */

type R = { id: string; kind: string; parentEntryId: string | null };
const tablet = (id: string, entry: string): R => ({ id, kind: "TABLET", parentEntryId: entry });
const pocket = (id: string, src: string | null): R => ({ id, kind: "POCKET", parentEntryId: src });
const rice = (id: string): R => ({ id, kind: "RICE", parentEntryId: null });

test("一牌位＋一基本寶袋 → 一群組、一子項", () => {
  const g = groupRowsForDisplay([tablet("t1", "e1"), pocket("p1", "e1")]);
  assert.equal(g.groups.length, 1);
  assert.equal(g.groups[0].pockets.length, 1);
  assert.equal(g.unpairedPockets.length, 0);
});

test("一牌位＋基本＋兩額外 → 同群組三個寶袋子項", () => {
  const g = groupRowsForDisplay([tablet("t1", "e1"), pocket("b", "e1"), pocket("x1", "e1"), pocket("x2", "e1")]);
  assert.equal(g.groups[0].pockets.length, 3);
  assert.equal(g.unpairedPockets.length, 0);
});

test("兩牌位各自寶袋 → 不交叉掛錯", () => {
  const g = groupRowsForDisplay([tablet("t1", "e1"), tablet("t2", "e2"), pocket("p1", "e1"), pocket("p2", "e2")]);
  const byTablet = new Map(g.groups.map((x) => [x.tablet.id, x.pockets.map((p) => p.id)]));
  assert.deepEqual(byTablet.get("t1"), ["p1"]);
  assert.deepEqual(byTablet.get("t2"), ["p2"]);
});

test("無 sourceEntryId／找不到牌位的寶袋 → 未配對區（不隱藏）", () => {
  const g = groupRowsForDisplay([tablet("t1", "e1"), pocket("p1", "e1"), pocket("orphan", null), pocket("nomatch", "e9")]);
  assert.equal(g.unpairedPockets.length, 2);
  assert.ok(g.unpairedPockets.some((p) => p.id === "orphan"));
  assert.ok(g.unpairedPockets.some((p) => p.id === "nomatch"));
});

test("群組後列印物件總數不減少、不重複", () => {
  const rows = [tablet("t1", "e1"), tablet("t2", "e2"), pocket("p1", "e1"), pocket("p2", "e2"), pocket("orphan", null), rice("r1")];
  const g = groupRowsForDisplay(rows);
  const out = g.groups.flatMap((x) => [x.tablet.id, ...x.pockets.map((p) => p.id)]).concat(g.unpairedPockets.map((p) => p.id), g.others.map((o) => o.id));
  assert.equal(out.length, rows.length, "不漏不重");
  assert.equal(new Set(out).size, rows.length, "無重複 id");
});

// §18 packing：不硬寫 5/11/4，依尺寸算；回歸案例合理
test("packing：三區塊記錄約寬92×高94 → 每頁多筆（2 欄以上）", () => {
  const p = computePacking({ recordWidthMm: 92, recordHeightMm: 94 });
  assert.ok(p.columns >= 2, "204mm 可用寬可放 2 欄");
  assert.ok(p.perPage >= 4, "至少 4 筆/頁");
  assert.ok(p.utilization > 0);
});

test("packing：寶袋 97×140 → 2 欄×2 列＝4 筆/頁（回歸）", () => {
  const p = computePacking({ recordWidthMm: 97, recordHeightMm: 140 });
  assert.equal(p.columns, 2);
  assert.equal(p.rows, 2);
  assert.equal(p.perPage, 4);
});

test("paginate：9 筆、每頁 4 → 4+4+1", () => {
  assert.deepEqual(paginate(9, 4), [4, 4, 1]);
  assert.deepEqual(paginate(5, 4), [4, 1]);
});
