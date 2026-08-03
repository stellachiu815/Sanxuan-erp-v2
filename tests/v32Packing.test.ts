import { test } from "node:test";
import assert from "node:assert/strict";
import { packTabletLayout, paginate } from "../src/components/ritual/tablets/packing";
import { buildAutoTabletLayout, validateLayout, SLOTS_PER_PAGE } from "../src/components/ritual/tablets/universalSalvationTabletA4";
import type { TabletRecordInput } from "../src/components/ritual/tablets/universalSalvationTabletA4";

/**
 * V32 §3 Packing 正式接入證明：
 *  正式 Sheet 呼叫 buildAutoTabletLayout（本測試直接驗證該引擎），版面來自 packing 核心，
 *  非硬寫 5/11/4；未啟用最高密度時安全回退既有固定槽位；啟用且更密且全合法時採用 packing。
 */

const mk = (n: number, main = "周府歷代祖先"): TabletRecordInput[] =>
  Array.from({ length: n }, (_, i) => ({
    entryId: `e${i}`,
    addressText: "台北市中正區某路100號",
    mainText: main,
    yangshangText: "周大明",
  }));

test("packTabletLayout 計算欄×列（不硬寫）：三區塊標準字 → 2 欄、≥3 列、每頁 >5", () => {
  const r = packTabletLayout({
    docType: "THREE_BLOCK",
    maxCharsByBox: { address: 11, main: 6, yangshang: 3 },
  });
  assert.equal(r.columns, 2);
  assert.ok(r.rows >= 3, `rows=${r.rows}`);
  assert.ok(r.perPage > 5, `perPage=${r.perPage}`);
  assert.equal(r.feasible, true);
});

test("buildAutoTabletLayout 預設（maximize 關）→ 回退固定槽位、每頁=基準、附 packing 摘要", () => {
  const layout = buildAutoTabletLayout("ANCESTOR_LINE", mk(7));
  assert.equal(layout.slotsPerPage, SLOTS_PER_PAGE.ANCESTOR_LINE);
  assert.ok(layout.packing, "應附 packing 摘要供預覽");
  assert.equal(layout.packing!.source, "fixed");
  assert.equal(validateLayout(layout).length, 0, "固定槽位版面合法");
});

test("buildAutoTabletLayout 啟用最高密度 → 採用 packing（每頁>基準）且完整合法", () => {
  const layout = buildAutoTabletLayout("ANCESTOR_LINE", mk(6), undefined, { maximize: true });
  assert.equal(layout.packing!.source, "packed");
  assert.ok(layout.packing!.perPage > SLOTS_PER_PAGE.ANCESTOR_LINE, `perPage=${layout.packing!.perPage}`);
  // 正式 Sheet 用的完整幾何驗證：不超界、不碰撞、不跨頁。
  assert.equal(validateLayout(layout).length, 0, "packing 版面必須全合法");
  // 6 筆全部就位（每筆至少一個區塊）。
  const recs = new Set(layout.allBlocks.map((b) => b.recordIndex));
  assert.equal(recs.size, 6);
});

test("冤親債主一律採專用固定 11 槽（非矩形網格，packing 不套用）", () => {
  const layout = buildAutoTabletLayout("DEBT_CREDITOR", mk(11), undefined, { maximize: true });
  assert.equal(layout.packing!.source, "fixed");
  assert.equal(layout.slotsPerPage, SLOTS_PER_PAGE.DEBT_CREDITOR);
  assert.match(layout.packing!.fallbackReason ?? "", /專用固定版面/);
});

test("寶袋啟用最高密度：grid 未超基準 → 回退固定 4", () => {
  const layout = buildAutoTabletLayout("POCKET", mk(4), undefined, { maximize: true });
  assert.equal(layout.packing!.source, "fixed");
  assert.equal(layout.slotsPerPage, SLOTS_PER_PAGE.POCKET);
});

test("paginate：同一筆不跨頁、分頁筆數正確", () => {
  assert.deepEqual(paginate(13, 6), [6, 6, 1]);
  assert.deepEqual(paginate(0, 6), []);
});
