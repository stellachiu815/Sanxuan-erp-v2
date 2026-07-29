import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import EntryRow, { initialNames } from "../src/components/ritual/EntryRow";
import type { EntryCategory, EntryJSON } from "../src/components/ritual/types";

/**
 * V27 真實元件渲染測試（react-dom/server）＋initialNames 單元測試。
 *
 * ⚠️ 需 Prisma 原生查詢引擎——import EntryRow 會連帶載入會初始化 Prisma 的模組，
 * 在沙盒（linux-arm64 引擎缺失）會噴 unhandledRejection。**請在 Mac 執行**：
 *   npx tsx --test tests/v27EditorRenderDb.test.ts
 * （與專案既有 *Db.test.ts 相同慣例——沙盒只跑純規則/結構測試。）
 */

function makeEntry(over: Partial<EntryJSON>): EntryJSON {
  return {
    id: "e1",
    category: "ANCESTOR_LINE",
    displayName: "周姓歷代祖先",
    yangshangName: null,
    yangshangNames: [],
    tabletAddress: null,
    notes: null,
    sortOrder: 1,
    ...over,
  };
}

test("initialNames：陣列優先/保留順序；空時退回舊 yangshangName；皆空為 []", () => {
  assert.deepEqual(initialNames(makeEntry({ yangshangNames: ["周財寶", "王大明"] })), ["周財寶", "王大明"]);
  assert.deepEqual(initialNames(makeEntry({ yangshangNames: [], yangshangName: "周財寶" })), ["周財寶"]);
  assert.deepEqual(initialNames(makeEntry({ yangshangNames: [], yangshangName: null })), []);
  assert.deepEqual(initialNames(makeEntry({ yangshangNames: ["周財寶", "王大明"], yangshangName: "忽略" })), ["周財寶", "王大明"]);
});

const CATEGORIES: EntryCategory[] = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"];
for (const category of CATEGORIES) {
  test(`EntryRow 渲染：${category} 既有陽上人（周財寶、王大明）顯示於畫面`, () => {
    const html = renderToStaticMarkup(
      React.createElement(EntryRow, {
        householdId: "F00001",
        year: 115,
        entry: makeEntry({ category, yangshangNames: ["周財寶", "王大明"], displayName: `${category}牌位` }),
        onRecordUpdated: () => {},
        showYangshang: true,
        requireYangshang: category !== "UNBORN_CHILD",
      })
    );
    assert.ok(html.includes("周財寶") && html.includes("王大明"), `${category} 應顯示既有陽上人`);
  });
}

test("EntryRow 渲染：相容舊單一 yangshangName（無 yangshangNames 陣列）", () => {
  const html = renderToStaticMarkup(
    React.createElement(EntryRow, {
      householdId: "F00001", year: 115,
      entry: makeEntry({ yangshangNames: [], yangshangName: "周財寶" }),
      onRecordUpdated: () => {}, showYangshang: true, requireYangshang: true,
    })
  );
  assert.ok(html.includes("周財寶"), "舊單一陽上人也要顯示");
});

test("EntryRow 渲染：真的沒有陽上人時，歷代祖先仍提示尚缺（不誤放行）", () => {
  const html = renderToStaticMarkup(
    React.createElement(EntryRow, {
      householdId: "F00001", year: 115,
      entry: makeEntry({ yangshangNames: [], yangshangName: null, tabletAddress: null }),
      onRecordUpdated: () => {}, showYangshang: true, requireYangshang: true, requireTabletAddress: true,
    })
  );
  assert.ok(html.includes("陽上人"), "缺陽上人提示");
});
