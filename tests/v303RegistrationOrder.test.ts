import { test } from "node:test";
import assert from "node:assert/strict";
import { computeBackfillOrders } from "../src/lib/registrationOrder";

/**
 * V30.3 普渡報名順序：既有資料補號排序規則（純函式）。
 * createdAt ASC；相同再 id ASC；每範圍各自 1..N；含取消保留原位；**不跳過任何號（含 44）**。
 */

function d(iso: string): Date {
  return new Date(iso);
}

test("依 createdAt ASC 補號 1..N（同一項目）", () => {
  const rows = [
    { id: "b", createdAt: d("2026-08-01T10:02:00Z") },
    { id: "a", createdAt: d("2026-08-01T10:01:00Z") },
    { id: "c", createdAt: d("2026-08-01T10:03:00Z") },
    { id: "d", createdAt: d("2026-08-01T10:04:00Z") },
  ];
  assert.deepEqual(computeBackfillOrders(rows), [
    { id: "a", registrationOrder: 1 },
    { id: "b", registrationOrder: 2 },
    { id: "c", registrationOrder: 3 },
    { id: "d", registrationOrder: 4 },
  ]);
});

test("createdAt 相同時以 id ASC 穩定決定順序", () => {
  const same = d("2026-08-01T10:00:00Z");
  const rows = [
    { id: "z", createdAt: same },
    { id: "a", createdAt: same },
    { id: "m", createdAt: same },
  ];
  assert.deepEqual(
    computeBackfillOrders(rows).map((r) => r.id),
    ["a", "m", "z"]
  );
});

test("取消資料也取得號碼並保留原位（不重排）", () => {
  // 假設第 2、3 筆為取消，仍占 2、3 號；名單顯示時過濾取消 → 可能出現 1、4（正確跳號）。
  const rows = [
    { id: "r1", createdAt: d("2026-08-01T10:01:00Z") }, // active
    { id: "r2", createdAt: d("2026-08-01T10:02:00Z") }, // cancelled（仍占 2）
    { id: "r3", createdAt: d("2026-08-01T10:03:00Z") }, // cancelled（仍占 3）
    { id: "r4", createdAt: d("2026-08-01T10:04:00Z") }, // active
  ];
  const orders = computeBackfillOrders(rows);
  assert.equal(orders.find((o) => o.id === "r1")!.registrationOrder, 1);
  assert.equal(orders.find((o) => o.id === "r4")!.registrationOrder, 4);
});

test("普渡順序連續、不跳過 44（祭改才跳 44）", () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({
    id: String(i).padStart(3, "0"),
    createdAt: d(`2026-08-01T10:00:${String(i).padStart(2, "0")}Z`),
  }));
  const orders = computeBackfillOrders(rows);
  // 第 44 筆的號碼就是 44（不被略過）
  assert.equal(orders[43].registrationOrder, 44);
  assert.ok(orders.some((o) => o.registrationOrder === 44), "普渡必須包含 44");
});

test("不同項目各自從 1（呼叫端分組後各自 computeBackfillOrders）", () => {
  const ancestors = [
    { id: "a2", createdAt: d("2026-08-01T10:02:00Z") },
    { id: "a1", createdAt: d("2026-08-01T10:01:00Z") },
  ];
  const yuanqin = [{ id: "y1", createdAt: d("2026-08-01T09:00:00Z") }];
  assert.deepEqual(computeBackfillOrders(ancestors).map((r) => r.registrationOrder), [1, 2]);
  assert.deepEqual(computeBackfillOrders(yuanqin).map((r) => r.registrationOrder), [1]);
});
