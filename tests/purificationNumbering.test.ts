import { test } from "node:test";
import assert from "node:assert/strict";
import {
  containsConsecutive44,
  isNumberBanned,
  nextAvailableNumber,
  assignSequentialNumbers,
  paginateForPrinting,
} from "../src/lib/purificationNumbering";

test("containsConsecutive44：跳過清單裡列出的每一個號碼都要被判定為禁用", () => {
  for (const n of [44, 144, 244, 344, 440, 441, 442, 443, 444, 445, 1440]) {
    assert.equal(containsConsecutive44(n), true, `${n} 應該被判定為含連續44`);
  }
});

test("containsConsecutive44：需求給出的正常號碼不可誤判為禁用", () => {
  for (const n of [42, 43, 45, 46, 143, 145, 146, 243, 245, 246]) {
    assert.equal(containsConsecutive44(n), false, `${n} 不應該被誤判為含連續44`);
  }
});

test("440 到 449 這個區間全部因為連續44而禁用", () => {
  for (let n = 440; n <= 449; n++) {
    assert.equal(containsConsecutive44(n), true, `${n} 應該被禁用`);
  }
});

test("編號43之後直接編到45，中間跳過44", () => {
  assert.equal(nextAvailableNumber(43), 45);
});

test("編號143之後直接編到145，中間跳過144", () => {
  assert.equal(nextAvailableNumber(143), 145);
});

test("isNumberBanned：管理者額外新增的禁用號碼也要生效", () => {
  assert.equal(isNumberBanned(88, [88]), true);
  assert.equal(isNumberBanned(89, [88]), false);
});

test("assignSequentialNumbers：從 0 開始依序編號，全新一批", () => {
  const result = assignSequentialNumbers(5, 0);
  assert.deepEqual(result, [1, 2, 3, 4, 5]);
});

test("assignSequentialNumbers：編號會自動跳過整個 440-449 區間", () => {
  const result = assignSequentialNumbers(3, 439);
  assert.deepEqual(result, [450, 451, 452]);
});

test("補報接續最後編號：目前最後有效編號是 46，補報 2 筆接續往後編", () => {
  const result = assignSequentialNumbers(2, 46);
  assert.deepEqual(result, [47, 48]);
});

test("取消後編號不重排：中間空號（例如取消的 4 號）不會被回填給後面新增的人", () => {
  // 模擬情境：目前有效編號 [1,2,3,5,6]（4 號因為取消而空出），
  // 新增人員應該接續「目前最後一個有效編號」6 繼續編號，而不是回填 4。
  const currentActiveNumbers = [1, 2, 3, 5, 6];
  const lastNumber = Math.max(...currentActiveNumbers);
  const result = assignSequentialNumbers(2, lastNumber);
  assert.deepEqual(result, [7, 8]);
  assert.ok(!result.includes(4), "不應該把空出來的 4 號回填給新的人");
});

test("一張 A4 剛好 33 筆，只會產生一張", () => {
  const items = Array.from({ length: 33 }, (_, i) => i + 1);
  const pages = paginateForPrinting(items, 33);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 33);
});

test("34 筆會自動產生第二張（第二張只有 1 筆）", () => {
  const items = Array.from({ length: 34 }, (_, i) => i + 1);
  const pages = paginateForPrinting(items, 33);
  assert.equal(pages.length, 2);
  assert.equal(pages[0].length, 33);
  assert.equal(pages[1].length, 1);
});

test("多張 A4 連續列印：100 筆會產生 4 張（33+33+33+1）", () => {
  const items = Array.from({ length: 100 }, (_, i) => i + 1);
  const pages = paginateForPrinting(items, 33);
  assert.equal(pages.length, 4);
  assert.deepEqual(pages.map((p) => p.length), [33, 33, 33, 1]);
});

test("補印單筆：只選一筆資料時，只會產生一張只有 1 格的預覽", () => {
  const pages = paginateForPrinting([{ id: "x" }], 33);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 1);
});

test("補印整張 A4：剛好 33 筆時，只會產生一張完整的預覽", () => {
  const items = Array.from({ length: 33 }, (_, i) => ({ id: String(i) }));
  const pages = paginateForPrinting(items, 33);
  assert.equal(pages.length, 1);
  assert.equal(pages[0].length, 33);
});

test("paginateForPrinting：pageSize 不合法要丟出例外", () => {
  assert.throws(() => paginateForPrinting([1, 2, 3], 0));
  assert.throws(() => paginateForPrinting([1, 2, 3], -1));
});

test("containsConsecutive44：拒絕負數輸入", () => {
  assert.throws(() => containsConsecutive44(-1));
});
