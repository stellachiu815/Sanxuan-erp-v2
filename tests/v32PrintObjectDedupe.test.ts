import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeDefaultPrintObjects } from "../src/lib/TabletBatchService";

/**
 * V32 阻擋修正（冤親等牌位重複）：列印物件層唯一性。
 * 同一 (sourceEntryId, itemType) 的預設物件（isExtra=false）只留一筆；額外寶袋（isExtra=true）保留全部。
 */

const it = (o: Partial<{ id: string; sourceEntryId: string; itemType: string; isExtra: boolean; printCount: number; createdAt: string }>) => ({
  id: o.id ?? "x", sourceEntryId: o.sourceEntryId ?? "e1", itemType: o.itemType ?? "TABLET",
  isExtra: o.isExtra ?? false, printCount: o.printCount ?? 0, createdAt: o.createdAt ?? "2026-08-01T00:00:00Z",
});

test("同一冤親 entry 的兩個預設 TABLET → 只留一筆", () => {
  const out = dedupeDefaultPrintObjects([
    it({ id: "a", sourceEntryId: "yq1", createdAt: "2026-08-01T00:00:00Z" }),
    it({ id: "b", sourceEntryId: "yq1", createdAt: "2026-08-02T00:00:00Z" }),
  ]);
  const tablets = out.filter((o) => o.sourceEntryId === "yq1" && o.itemType === "TABLET");
  assert.equal(tablets.length, 1);
});

test("保留有列印紀錄者（printCount 最大）", () => {
  const out = dedupeDefaultPrintObjects([
    it({ id: "a", sourceEntryId: "yq1", printCount: 0 }),
    it({ id: "b", sourceEntryId: "yq1", printCount: 2 }),
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "b");
});

test("printCount 相同→保留 createdAt 較早者", () => {
  const out = dedupeDefaultPrintObjects([
    it({ id: "late", sourceEntryId: "yq1", createdAt: "2026-08-05T00:00:00Z" }),
    it({ id: "early", sourceEntryId: "yq1", createdAt: "2026-08-01T00:00:00Z" }),
  ]);
  assert.equal(out[0].id, "early");
});

test("不同 entry / 不同 itemType 不合併；額外寶袋全保留", () => {
  const out = dedupeDefaultPrintObjects([
    it({ id: "t1", sourceEntryId: "e1", itemType: "TABLET" }),
    it({ id: "t2", sourceEntryId: "e2", itemType: "TABLET" }),        // 不同 entry
    it({ id: "p1", sourceEntryId: "e1", itemType: "POCKET" }),        // 同 entry 不同 type
    it({ id: "x1", sourceEntryId: "e1", itemType: "POCKET", isExtra: true }),
    it({ id: "x2", sourceEntryId: "e1", itemType: "POCKET", isExtra: true }),
  ]);
  assert.equal(out.filter((o) => !o.isExtra).length, 3, "3 個預設物件（e1-TABLET, e2-TABLET, e1-POCKET）");
  assert.equal(out.filter((o) => o.isExtra).length, 2, "2 個額外寶袋全保留");
});
