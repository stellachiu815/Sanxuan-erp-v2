import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTempleEventName } from "../src/lib/templeEventNaming";

test("formatTempleEventName：115 年度祭改 → 民國一一五年度祭改（逐字讀法，不是一百一十五）", () => {
  assert.equal(formatTempleEventName(115, "祭改"), "民國一一五年度祭改");
});

test("formatTempleEventName：套用在光明燈", () => {
  assert.equal(formatTempleEventName(115, "光明燈"), "民國一一五年度光明燈");
});

test("formatTempleEventName：兩位數年度不會補零成三位數逐字讀法", () => {
  assert.equal(formatTempleEventName(99, "宮慶"), "民國九九年度宮慶");
});

test("formatTempleEventName：0 開頭的年度數字要轉成〇", () => {
  assert.equal(formatTempleEventName(101, "太歲燈"), "民國一〇一年度太歲燈");
});
