import { test } from "node:test";
import assert from "node:assert/strict";
import {
  printNumberOf, autoAssignWorkOrders, renumberByCurrentSort, swapWorkOrder, hasNoDuplicateWorkOrders,
  type WorkOrderRow,
} from "../src/lib/workOrder";
import { resolvePrintMainText, resolvePrintAddress } from "../src/lib/tabletPrintFields";

/** V31 §8：workOrder / printMainText / 地址來源。 */

// 1. workOrder 與 registrationOrder 可不同；未指派回退 registrationOrder
test("printNumberOf：有 workOrder 用 workOrder；無則回退 registrationOrder；都無回 null", () => {
  assert.equal(printNumberOf(5, 12), 5, "workOrder 與 registrationOrder 可不同，列印用 workOrder");
  assert.equal(printNumberOf(null, 12), 12, "未指派 workOrder → 回退 registrationOrder");
  assert.equal(printNumberOf(null, null), null);
});

// 2/3. 同項目 workOrder 不重複；祖先與冤親各自都能有 No.001
test("autoAssignWorkOrders：各項目各自 1..N，已有號不覆蓋", () => {
  const rows: WorkOrderRow[] = [
    { id: "a1", categoryKey: "US_ANCESTOR", workOrder: null },
    { id: "a2", categoryKey: "US_ANCESTOR", workOrder: null },
    { id: "y1", categoryKey: "US_YUANQIN", workOrder: null },
    { id: "y2", categoryKey: "US_YUANQIN", workOrder: 5 }, // 已有號不覆蓋
  ];
  const out = autoAssignWorkOrders(rows);
  const m = new Map(out.map((o) => [o.id, o.workOrder]));
  assert.equal(m.get("a1"), 1);
  assert.equal(m.get("a2"), 2);
  assert.equal(m.get("y1"), 6, "US_YUANQIN 已有 5 → 接續 6");
  assert.ok(!m.has("y2"), "已有號不重指派");
});

test("祖先與冤親可各自都有 No.001（各項目獨立編號）", () => {
  const out = renumberByCurrentSort([
    { id: "a1", categoryKey: "US_ANCESTOR", workOrder: null },
    { id: "y1", categoryKey: "US_YUANQIN", workOrder: null },
  ]);
  const m = new Map(out.map((o) => [o.id, o.workOrder]));
  assert.equal(m.get("a1"), 1);
  assert.equal(m.get("y1"), 1, "冤親也從 1，不接續祖先");
});

test("renumberByCurrentSort：同項目依排序重編 1..N", () => {
  const out = renumberByCurrentSort([
    { id: "a", categoryKey: "US_ANCESTOR", workOrder: 9 },
    { id: "b", categoryKey: "US_ANCESTOR", workOrder: 3 },
    { id: "c", categoryKey: "US_ANCESTOR", workOrder: 7 },
  ]);
  assert.deepEqual(out.map((o) => o.workOrder), [1, 2, 3]);
});

test("swapWorkOrder：改號與佔用者互換，不產生重號", () => {
  const rows: WorkOrderRow[] = [
    { id: "zhou", categoryKey: "US_ANCESTOR", workOrder: 1 },
    { id: "wang", categoryKey: "US_ANCESTOR", workOrder: 2 },
  ];
  // 周財寶改成 2 → 與王大明(2)互換
  const out = swapWorkOrder(rows, "zhou", 2);
  const m = new Map(out.map((o) => [o.id, o.workOrder]));
  assert.equal(m.get("zhou"), 2);
  assert.equal(m.get("wang"), 1);
  const applied = rows.map((r) => ({ ...r, workOrder: m.get(r.id) ?? r.workOrder }));
  assert.ok(hasNoDuplicateWorkOrders(applied), "互換後無重號");
});

test("hasNoDuplicateWorkOrders：同項目重號→false；不同項目同號→true", () => {
  assert.equal(hasNoDuplicateWorkOrders([
    { id: "a", categoryKey: "US_ANCESTOR", workOrder: 1 },
    { id: "b", categoryKey: "US_ANCESTOR", workOrder: 1 },
  ]), false);
  assert.equal(hasNoDuplicateWorkOrders([
    { id: "a", categoryKey: "US_ANCESTOR", workOrder: 1 },
    { id: "y", categoryKey: "US_YUANQIN", workOrder: 1 },
  ]), true);
});

// 6/7. printMainText：空白用預設；有值只覆寫單筆
test("resolvePrintMainText：空白→系統正式主文；有值→只覆寫該筆", () => {
  assert.equal(resolvePrintMainText("周府歷代祖先", null), "周府歷代祖先");
  assert.equal(resolvePrintMainText("周府歷代祖先", "  "), "周府歷代祖先");
  assert.equal(resolvePrintMainText("無緣子女", "本宅地基主"), "本宅地基主");
});

// 12. 地址 fallback 絕不使用 Household.address
test("resolvePrintAddress：entry 優先 → 否則 Member.address → 絕不 Household（函式不接受家戶地址）", () => {
  assert.equal(resolvePrintAddress("台北市中正區1號", "新北市板橋區2號"), "台北市中正區1號", "entry 快照優先");
  assert.equal(resolvePrintAddress(null, "新北市板橋區2號"), "新北市板橋區2號", "無 entry → Member.address");
  assert.equal(resolvePrintAddress("", ""), "", "皆無 → 空（不硬帶家戶地址）");
});
