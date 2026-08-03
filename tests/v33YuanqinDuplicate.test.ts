import { test } from "node:test";
import assert from "node:assert/strict";
import { duplicateDefaultPrintObjects } from "../src/lib/TabletBatchService";
import { classifyYuanqin, type YuanqinEntryRow, type YuanqinPrintObjectRow } from "../src/lib/yuanqinDuplicateAnalysis";

/** V33 §9 冤親重複分類與去重候選（純函式）。 */

const po = (o: Partial<YuanqinPrintObjectRow>): YuanqinPrintObjectRow => ({
  additionalPrintItemId: o.additionalPrintItemId ?? "a", entryId: o.entryId ?? "e1", itemType: o.itemType ?? "TABLET",
  isExtra: o.isExtra ?? false, status: o.status ?? "PENDING_PRINT", deletedAt: o.deletedAt ?? null,
  printCount: o.printCount ?? 0, createdAt: o.createdAt ?? "2026-08-01T00:00:00Z",
});
const en = (o: Partial<YuanqinEntryRow>): YuanqinEntryRow => ({
  entryId: o.entryId ?? "e1", ritualRecordId: o.ritualRecordId ?? "r1", householdId: o.householdId ?? "H1",
  memberId: o.memberId ?? "m1", displayName: o.displayName ?? "累世冤親債主", tabletAddress: o.tabletAddress ?? null,
  memberAddress: o.memberAddress ?? null, registrationItemId: o.registrationItemId ?? "ri1", workOrder: o.workOrder ?? null,
  status: o.status ?? "CONFIRMED", deletedAt: o.deletedAt ?? null,
});

test("同一 Entry 兩筆預設 TABLET → 一筆移除候選；額外寶袋不列入", () => {
  // duplicateDefaultPrintObjects 需 {id, sourceEntryId, itemType, isExtra, printCount, createdAt}
  const obj = (id: string, sourceEntryId: string, itemType: string, isExtra: boolean, printCount: number) => ({
    id, sourceEntryId, itemType, isExtra, printCount, createdAt: "2026-08-01T00:00:00Z",
  });
  const dups = duplicateDefaultPrintObjects([
    obj("a", "e1", "TABLET", false, 1),
    obj("b", "e1", "TABLET", false, 0),
    obj("x", "e1", "POCKET", true, 0),
  ]);
  assert.equal(dups.length, 1);
  assert.equal(dups[0].keepId, "a"); // 有列印紀錄者保留
  assert.deepEqual(dups[0].removeIds, ["b"]);
});

test("classify：DUP_DEFAULT_TABLET", () => {
  const list = classifyYuanqin(
    [en({ entryId: "e1" })],
    [po({ entryId: "e1", additionalPrintItemId: "a" }), po({ entryId: "e1", additionalPrintItemId: "b" })]
  );
  assert.ok(list[0].classes.includes("DUP_DEFAULT_TABLET"));
});

test("classify：同一 Member 兩筆有效冤親 → DUP_YUANQIN_ITEM（NEEDS_REVIEW）", () => {
  const list = classifyYuanqin(
    [en({ entryId: "e1", memberId: "m1" }), en({ entryId: "e2", memberId: "m1" })],
    [po({ entryId: "e1" }), po({ entryId: "e2" })]
  );
  assert.ok(list.every((c) => c.classes.includes("DUP_YUANQIN_ITEM")));
});

test("classify：姓名相同但不同 Member → LEGIT_MULTIPLE（不誤合併）", () => {
  const list = classifyYuanqin(
    [en({ entryId: "e1", memberId: "m1", displayName: "累世冤親債主" }), en({ entryId: "e2", memberId: "m2", displayName: "累世冤親債主" })],
    [po({ entryId: "e1" }), po({ entryId: "e2" })]
  );
  assert.ok(list.every((c) => c.classes.includes("LEGIT_MULTIPLE")));
});

test("classify：CANCELLED/軟刪 → CANCELLED_HISTORY，不進有效", () => {
  const list = classifyYuanqin(
    [en({ entryId: "e1", status: "CANCELLED" }), en({ entryId: "e2", deletedAt: "2026-08-01T00:00:00Z" })],
    []
  );
  assert.ok(list.every((c) => c.classes.includes("CANCELLED_HISTORY")));
});
