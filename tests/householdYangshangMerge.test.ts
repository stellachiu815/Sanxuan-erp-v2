import { test } from "node:test";
import assert from "node:assert/strict";
import { partitionYangshangForMerge } from "../src/lib/householdYangshangMerge";

/** V36-H 家戶合併：固定陽上人搬移去重（純函式）。 */

test("目標已有同名 → 略過；其餘搬移", () => {
  const { toMove, skipped } = partitionYangshangForMerge(
    ["王小明", "李美華"],
    [
      { id: "a", name: "王小明" }, // 目標已有 → 略過
      { id: "b", name: "陳大同" }, // 新 → 搬移
    ]
  );
  assert.deepEqual(toMove.map((r) => r.id), ["b"]);
  assert.deepEqual(skipped.map((r) => r.id), ["a"]);
});

test("名稱比對用 trim 後字串相等", () => {
  const { toMove, skipped } = partitionYangshangForMerge(
    [" 王小明 "],
    [{ id: "a", name: "王小明" }]
  );
  assert.equal(toMove.length, 0);
  assert.equal(skipped.length, 1);
});

test("來源內部同名只搬一筆，避免自身撞唯一鍵", () => {
  const { toMove, skipped } = partitionYangshangForMerge(
    [],
    [
      { id: "a", name: "重名" },
      { id: "b", name: "重名" },
    ]
  );
  assert.deepEqual(toMove.map((r) => r.id), ["a"]);
  assert.deepEqual(skipped.map((r) => r.id), ["b"]);
});

test("目標為空 → 全部搬移", () => {
  const { toMove, skipped } = partitionYangshangForMerge([], [{ id: "a", name: "甲" }, { id: "b", name: "乙" }]);
  assert.equal(toMove.length, 2);
  assert.equal(skipped.length, 0);
});
