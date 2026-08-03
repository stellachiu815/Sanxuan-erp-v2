import { test } from "node:test";
import assert from "node:assert/strict";
import { fitVerticalFont, fontConfigFor, FONT_CONFIG } from "../src/components/ritual/tablets/fontFit";

/** V31 §13B 字級自動縮放 + 無緣子女主文與祖先共用同一設定來源。 */

const MAIN = FONT_CONFIG.main; // 祖先／乙位／無緣共用

test("短字使用最大合理字級（不放大超過基準）", () => {
  // 三區塊主文盒 50×94mm；短牌位名應維持 maxPx。
  const r = fitVerticalFont("王府歷代祖先".length, 50, 94, MAIN);
  assert.equal(r.px, MAIN.maxPx);
  assert.equal(r.overflow, false);
});

test("長字逐級縮小、但不低於最小字級", () => {
  const long = "陳林黃張李吳王劉蔡楊許鄭謝郭洪曾廖賴徐周葉蘇府歷代祖先之蓮座".length;
  const r = fitVerticalFont(long * 3, 50, 94, MAIN);
  assert.ok(r.px <= MAIN.maxPx && r.px >= MAIN.minPx);
});

test("超過最小字級仍放不下 → overflow warning（不裁字，回最小字級）", () => {
  const r = fitVerticalFont(100000, 50, 94, MAIN);
  assert.equal(r.px, MAIN.minPx);
  assert.equal(r.overflow, true);
});

test("無緣子女主文與祖先共用同一設定來源（fontConfigFor('main')），不各自 hard-code", () => {
  // 兩者都取同一 config 物件參考。
  assert.strictEqual(fontConfigFor("main"), FONT_CONFIG.main);
});

test("短無緣子女主文字級不超過祖先標準字級（相同盒、相同 config → 相同 px）", () => {
  const ancestor = fitVerticalFont("某姓歷代祖先".length, 50, 94, fontConfigFor("main"));
  const wuyuan = fitVerticalFont("無緣子女".length, 50, 94, fontConfigFor("main"));
  assert.equal(wuyuan.px, ancestor.px, "短文字兩者同字級");
  assert.ok(wuyuan.px <= MAIN.maxPx, "不超過基準最大字級");
});

test("長無緣子女主文可向下縮小（超過容量時）", () => {
  const short = fitVerticalFont("無緣子女".length, 50, 94, fontConfigFor("main")).px;
  const long = fitVerticalFont(500, 50, 94, fontConfigFor("main")).px;
  assert.ok(long <= short, "長文字字級 ≤ 短文字字級");
});

test("各盒各自獨立設定：main/address/yangshang/pocketMain 不共用同一字級來源", () => {
  assert.notStrictEqual(fontConfigFor("main"), fontConfigFor("address"));
  assert.notStrictEqual(fontConfigFor("address"), fontConfigFor("yangshang"));
  assert.notStrictEqual(fontConfigFor("main"), fontConfigFor("pocketMain"));
});

test("地址盒 15×150 短址用最大字級、超長址縮小或 overflow", () => {
  const addr = fontConfigFor("address");
  assert.equal(fitVerticalFont("北市".length, 15, 150, addr).px, addr.maxPx);
  const long = fitVerticalFont(2000, 15, 150, addr);
  assert.ok(long.px <= addr.maxPx);
});
