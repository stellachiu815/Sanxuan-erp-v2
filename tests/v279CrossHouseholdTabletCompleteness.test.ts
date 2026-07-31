import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tabletMissingFieldsForCategory,
  checkUniversalSalvationItem,
  UNIVERSAL_SALVATION_CATEGORY_TO_ITEM_KEY,
} from "../src/lib/dataCompleteness";

/**
 * V27.9：跨家戶批次牌位 PDF 的「資料缺漏阻擋」規則測試（純函式，沙盒可跑）。
 *
 * 核心不變量：PrintItemsCenter 預覽/正式 PDF 的缺漏判定（tabletMissingFieldsForCategory）
 * 與「完成正式列印」伺服器 gate 使用的 checkUniversalSalvationItem 為**同一支函式**，
 * 保證不會出現「預覽阻擋、完成列印卻放行」或反之的破口。
 *
 * 類別→計價 itemKey：ANCESTOR_LINE=US_ANCESTOR、INDIVIDUAL_SOUL=US_ZHENGHUN、
 * DEBT_CREDITOR=US_YUANQIN、UNBORN_CHILD=US_WUYUAN。
 */
const CATEGORIES = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"];
const YANGSHANG_CASES: string[][] = [[], ["王小明"], ["王小明", "王大明"]];
const ADDRESS_CASES: (string | null)[] = [null, "", "   ", "台北市中正區"];

function gateLabels(category: string, yangshangNames: string[], tabletAddress: string | null): string[] {
  const key = UNIVERSAL_SALVATION_CATEGORY_TO_ITEM_KEY[category];
  return checkUniversalSalvationItem(key, { yangshangNames, tabletAddress }).missing.map((m) => m.label);
}

test("歷代祖先／乙位正魂：缺陽上人＋牌位地址的判定與標籤正確", () => {
  for (const category of ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"]) {
    assert.deepEqual(tabletMissingFieldsForCategory(category, [], null), ["陽上人", "牌位地址"]);
    assert.deepEqual(tabletMissingFieldsForCategory(category, ["王小明"], null), ["牌位地址"]);
    assert.deepEqual(tabletMissingFieldsForCategory(category, [], "台北市"), ["陽上人"]);
    assert.deepEqual(tabletMissingFieldsForCategory(category, ["王小明"], "台北市"), []);
    // 空白／全空白地址視為缺（與 has() trim 語意一致）。
    assert.deepEqual(tabletMissingFieldsForCategory(category, ["王小明"], "   "), ["牌位地址"]);
  }
});

test("冤親債主／無緣子女：無必填欄位，一律視為完整", () => {
  for (const category of ["DEBT_CREDITOR", "UNBORN_CHILD"]) {
    for (const ys of YANGSHANG_CASES) {
      for (const addr of ADDRESS_CASES) {
        assert.deepEqual(tabletMissingFieldsForCategory(category, ys, addr), []);
      }
    }
  }
});

test("與伺服器 gate（checkUniversalSalvationItem）逐一比對，規則與標籤完全一致", () => {
  for (const category of CATEGORIES) {
    for (const ys of YANGSHANG_CASES) {
      for (const addr of ADDRESS_CASES) {
        const mine = tabletMissingFieldsForCategory(category, ys, addr);
        const gate = gateLabels(category, ys, addr);
        assert.deepEqual(
          mine,
          gate,
          `不一致：category=${category} yangshang=${JSON.stringify(ys)} address=${JSON.stringify(addr)} → mine=${JSON.stringify(mine)} gate=${JSON.stringify(gate)}`
        );
      }
    }
  }
});

test("未知類別：不誤擋（回空陣列，與 gate default 相同）", () => {
  assert.deepEqual(tabletMissingFieldsForCategory("SOMETHING_ELSE", [], null), []);
});
