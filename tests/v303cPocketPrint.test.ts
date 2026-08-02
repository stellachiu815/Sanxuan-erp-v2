import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTabletLayout,
  validateLayout,
  SLOTS_PER_PAGE,
} from "../src/components/ritual/tablets/universalSalvationTabletA4";
import { buildTabletGroups, type BatchItem } from "../src/lib/TabletBatchService";

/** V30.3 寶袋（POCKET）正式 A4 版面：每頁 4 筆、mm 座標合法、分頁正確、與其他牌位批次不互相影響。 */

function pockets(n: number) {
  return Array.from({ length: n }, (_, i) => ({ mainText: `寶袋${i + 1}`, addressText: `地址${i + 1}`, yangshangText: `陽上${i + 1}` }));
}
function pageRecordCounts(layout: ReturnType<typeof buildTabletLayout>) {
  return layout.pages.map((p) => new Set(p.blocks.map((b) => b.recordIndex)).size);
}

test("寶袋每頁固定 4 筆", () => {
  assert.equal(SLOTS_PER_PAGE.POCKET, 4);
});

test("單筆寶袋 → 1 頁 1 筆，版面合法（在 3mm 安全區、無碰撞、不跨頁）", () => {
  const layout = buildTabletLayout("POCKET", pockets(1));
  assert.equal(layout.pages.length, 1);
  assert.deepEqual(pageRecordCounts(layout), [1]);
  assert.deepEqual(validateLayout(layout), []);
});

test("4 筆 → 1 頁（滿頁）且合法", () => {
  const layout = buildTabletLayout("POCKET", pockets(4));
  assert.deepEqual(pageRecordCounts(layout), [4]);
  assert.deepEqual(validateLayout(layout), []);
});

test("超過單頁：5 筆 → 2 頁 4+1；8 筆 → 2 頁 4+4；9 筆 → 3 頁 4+4+1", () => {
  assert.deepEqual(pageRecordCounts(buildTabletLayout("POCKET", pockets(5))), [4, 1]);
  assert.deepEqual(pageRecordCounts(buildTabletLayout("POCKET", pockets(8))), [4, 4]);
  assert.deepEqual(pageRecordCounts(buildTabletLayout("POCKET", pockets(9))), [4, 4, 1]);
  assert.deepEqual(validateLayout(buildTabletLayout("POCKET", pockets(9))), []);
});

function batchItem(id: string, itemType: string, sourceCategory: string, registrationOrder: number | null): BatchItem {
  return {
    id, itemType, registrationOrder, sourceCategory,
    sourceCategoryLabel: sourceCategory, sourceDisplayName: id, sourceLocation: null,
    sourceYangshangName: null, sourceYangshangNames: [], tabletMissingFields: [],
    status: "PENDING", printCount: 0, household: { id: "H", name: "戶" },
  };
}

test("寶袋分組獨立，不影響其他四種牌位批次", () => {
  const items: BatchItem[] = [
    batchItem("p1", "POCKET", "ANCESTOR_LINE", 1),
    batchItem("a1", "TABLET", "ANCESTOR_LINE", 1),
    batchItem("d1", "TABLET", "DEBT_CREDITOR", 1),
    batchItem("p2", "POCKET", "ANCESTOR_LINE", 2),
  ];
  const groups = buildTabletGroups(items);
  const byType = new Map(groups.map((g) => [g.documentType, g.records.length]));
  assert.equal(byType.get("POCKET"), 2, "寶袋 2 筆自成一組");
  assert.equal(byType.get("ANCESTOR_LINE"), 1, "三區塊牌位不含寶袋");
  assert.equal(byType.get("DEBT_CREDITOR"), 1, "冤親不含寶袋");
});

test("寶袋作業號碼＝registrationOrder；NULL 不帶入號碼", () => {
  const groups = buildTabletGroups([
    batchItem("p1", "POCKET", "ANCESTOR_LINE", 5),
    batchItem("p2", "POCKET", "ANCESTOR_LINE", null),
  ]);
  const pocket = groups.find((g) => g.documentType === "POCKET")!;
  assert.equal(pocket.records[0].workNumber, 5);
  assert.equal(pocket.records[1].workNumber ?? null, null);
});
