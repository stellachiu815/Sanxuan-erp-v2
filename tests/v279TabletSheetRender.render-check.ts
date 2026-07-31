import * as React from "react";
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { UniversalSalvationTabletSheet, type PrintTabletEntry } from "../src/components/ritual/tablets";

/**
 * V27.9：確認跨家戶批次牌位「螢幕預覽」與「列印 Portal」各自 render 都會產出 .print-sheet，
 * 且同一份資料分兩處 render 不會出現「同一個 React element 被消耗成空」。
 *
 * 使用 React.createElement（不寫 JSX）以避免測試執行環境的 JSX transform 差異。
 */
const h = React.createElement;

const records: PrintTabletEntry[] = [
  { displayName: "王姓歷代祖先", yangshangName: "王小明", yangshangNames: ["王小明"], location: "台北市中正區", notes: null },
  { displayName: "李姓歷代祖先", yangshangName: "李大明", yangshangNames: ["李大明"], location: "新北市板橋區", notes: null },
];

function sheet(documentType: string, keyPrefix: string) {
  return h(UniversalSalvationTabletSheet as React.ComponentType<Record<string, unknown>>, {
    key: `${keyPrefix}-${documentType}`,
    documentType,
    records,
    mode: "print",
  });
}

function countPrintSheets(html: string): number {
  return (html.match(/print-sheet/g) ?? []).length;
}

test("UniversalSalvationTabletSheet 會產生 .print-sheet", () => {
  const html = renderToStaticMarkup(sheet("ANCESTOR_LINE", "s"));
  assert.ok(html.includes("print-sheet"), "輸出應含 .print-sheet");
  assert.ok(html.includes("王姓歷代祖先"), "應含牌位主文");
});

test("同一份資料分別 render 兩次（screen / print）——兩份各自都含 .print-sheet，不會其中一份為空", () => {
  const screen = renderToStaticMarkup(h("div", { className: "screen-preview" }, sheet("ANCESTOR_LINE", "screen")));
  const print = renderToStaticMarkup(h("div", { id: "tablet-print-root" }, sheet("ANCESTOR_LINE", "print")));
  assert.ok(countPrintSheets(screen) > 0, "螢幕預覽份應含 .print-sheet");
  assert.ok(print.includes('id="tablet-print-root"'), "Portal 容器應為 #tablet-print-root");
  assert.ok(countPrintSheets(print) > 0, "Portal 份應含 .print-sheet");
});

test("四種牌位皆可 render 出 .print-sheet", () => {
  for (const dt of ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD", "DEBT_CREDITOR"]) {
    const html = renderToStaticMarkup(sheet(dt, "t"));
    assert.ok(html.includes("print-sheet"), `${dt} 應含 .print-sheet`);
  }
});
