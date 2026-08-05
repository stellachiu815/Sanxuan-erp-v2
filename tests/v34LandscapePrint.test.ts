import { test } from "node:test";
import assert from "node:assert/strict";
import { chunk, DENSITY_COLS } from "../src/components/universal-salvation/v34/TabletLandscapeSheetV34";

/** V34 橫式列印版型：分頁（page-break）純邏輯。純呈現元件，只測分頁與密度對應。 */

test("密度對應：標準 7 欄/頁（V36.14 由 8→7）、省紙 10 欄/頁", () => {
  assert.equal(DENSITY_COLS.standard, 7);
  assert.equal(DENSITY_COLS.economy, 10);
});

test("分頁：同一筆不跨頁，依每頁欄數切頁", () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  assert.deepEqual(chunk(items, 8).map((p) => p.length), [8, 8, 4]);
  assert.deepEqual(chunk(items, 10).map((p) => p.length), [10, 10]);
  assert.deepEqual(chunk([], 8), []);
  assert.deepEqual(chunk([1, 2, 3], 8), [[1, 2, 3]]);
});
