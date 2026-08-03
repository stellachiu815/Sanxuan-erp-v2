import { test } from "node:test";
import assert from "node:assert/strict";
import { sortByTypeThenOrder, sortByRegistrationOrder, orderCell } from "../src/lib/rosterSort";

/** V30.9 §6 / V31 §5：各報名項目使用自身 registrationOrder，不接續、不用全域 row number。 */

const RANK = { US_ANCESTOR: 1, US_ZHENGHUN: 2 };

test("祖先 order 1、2；冤親 order 1、2 → 冤親仍顯示 1、2，不是 3、4", () => {
  // 冤親工作表只取 US_YUANQIN，用其自身 registrationOrder。
  const debt = [
    { key: "US_YUANQIN", registrationOrder: 2 },
    { key: "US_YUANQIN", registrationOrder: 1 },
  ];
  const sorted = sortByRegistrationOrder(debt).map((r) => orderCell(r.registrationOrder));
  assert.deepEqual(sorted, [1, 2], "冤親編號 1,2（不接續祖先變 3,4）");
});

test("祖先＋乙位同表：各自從 1 開始、分區塊（先祖先全部、再乙位全部）", () => {
  const rows = [
    { key: "US_ZHENGHUN", registrationOrder: 1 },
    { key: "US_ANCESTOR", registrationOrder: 2 },
    { key: "US_ZHENGHUN", registrationOrder: 2 },
    { key: "US_ANCESTOR", registrationOrder: 1 },
  ];
  const sorted = sortByTypeThenOrder(rows, RANK);
  assert.deepEqual(
    sorted.map((r) => `${r.key}:${r.registrationOrder}`),
    ["US_ANCESTOR:1", "US_ANCESTOR:2", "US_ZHENGHUN:1", "US_ZHENGHUN:2"],
    "祖先區塊(1,2) 後接乙位區塊(1,2)，各自從 1"
  );
});

test("混合輸入順序不影響各類編號結果", () => {
  const a = [
    { key: "US_ANCESTOR", registrationOrder: 1 },
    { key: "US_ZHENGHUN", registrationOrder: 1 },
    { key: "US_ANCESTOR", registrationOrder: 2 },
  ];
  const b = [
    { key: "US_ZHENGHUN", registrationOrder: 1 },
    { key: "US_ANCESTOR", registrationOrder: 2 },
    { key: "US_ANCESTOR", registrationOrder: 1 },
  ];
  const norm = (rows: typeof a) => sortByTypeThenOrder(rows, RANK).map((r) => `${r.key}:${r.registrationOrder}`);
  assert.deepEqual(norm(a), norm(b));
});

test("NULL order 排最後並顯示「—」", () => {
  const rows = [
    { key: "US_ANCESTOR", registrationOrder: null },
    { key: "US_ANCESTOR", registrationOrder: 1 },
  ];
  const sorted = sortByTypeThenOrder(rows, RANK);
  assert.equal(sorted[0].registrationOrder, 1);
  assert.equal(sorted[1].registrationOrder, null);
  assert.equal(orderCell(sorted[1].registrationOrder), "—");
});

test("不使用全域 row number：orderCell 直接反映自身 registrationOrder", () => {
  assert.equal(orderCell(1), 1);
  assert.equal(orderCell(17), 17);
  assert.equal(orderCell(null), "—");
});
