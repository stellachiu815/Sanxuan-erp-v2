import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTabletLayout,
  validateLayout,
  isOffsetWithinBounds,
  inBounds,
  gapOK,
  SLOTS_PER_PAGE,
  DOCUMENT_BLOCKS,
  BLOCK_SIZE,
  USABLE,
  TABLET_A4_TEMPLATE_ID,
  type TabletDocumentType,
  type TabletRecordInput,
} from "../src/components/ritual/tablets/universalSalvationTabletA4";

/**
 * UNIVERSAL_SALVATION_TABLET_A4_V1 版面引擎單元測試（純函式，沙盒可跑）。
 * 涵蓋：boundary / collision / minimum-gap / atomic-same-page；固定 5、11 筆/頁；
 * 第 6/12 筆進第 2 頁；最後一頁不補空白；offset 超界阻擋。
 */

const recs = (n: number): TabletRecordInput[] =>
  Array.from({ length: n }, (_, i) => ({ entryId: `e${i}`, registrationId: `r${i}`, addressText: `地址${i}`, mainText: `主文字${i}`, yangshangText: `陽上${i}叩薦` }));

const THREE: TabletDocumentType[] = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD"];

test("模板 id 與每頁筆數固定（三區塊 5、冤親 11）", () => {
  assert.equal(TABLET_A4_TEMPLATE_ID, "UNIVERSAL_SALVATION_TABLET_A4_V1");
  for (const t of THREE) assert.equal(SLOTS_PER_PAGE[t], 5);
  assert.equal(SLOTS_PER_PAGE.DEBT_CREDITOR, 11);
});

test("滿頁三區塊型（5 筆）：boundary/collision/gap/atomic 全部合法", () => {
  for (const t of THREE) {
    const layout = buildTabletLayout(t, recs(5));
    assert.equal(layout.pages.length, 1);
    assert.equal(layout.allBlocks.length, 15, `${t} 5 筆×3 塊`);
    assert.deepEqual(validateLayout(layout), []);
  }
});

test("滿頁冤親型（11 筆）：合法；且完全無主文字矩形", () => {
  const layout = buildTabletLayout("DEBT_CREDITOR", recs(11));
  assert.equal(layout.pages.length, 1);
  assert.equal(layout.allBlocks.length, 22, "11 筆×2 塊（無主文字）");
  assert.equal(layout.allBlocks.some((b) => b.blockType === "main"), false, "不建立主文字矩形");
  assert.deepEqual(validateLayout(layout), []);
  assert.deepEqual(DOCUMENT_BLOCKS.DEBT_CREDITOR, ["address", "yangshang"]);
});

test("分頁：第 6 筆三區塊型完整進第 2 頁；同一筆不跨頁", () => {
  const layout = buildTabletLayout("ANCESTOR_LINE", recs(6));
  assert.equal(layout.pages.length, 2);
  const rec5 = layout.allBlocks.filter((b) => b.recordIndex === 5); // 第 6 筆（0-based）
  assert.equal(rec5.length, 3);
  assert.ok(rec5.every((b) => b.pageIndex === 1 && b.slotIndex === 0), "第 6 筆→page1、slot0");
  assert.deepEqual(validateLayout(layout), []);
});

test("分頁：第 12 筆冤親型完整進第 2 頁", () => {
  const layout = buildTabletLayout("DEBT_CREDITOR", recs(12));
  assert.equal(layout.pages.length, 2);
  const rec11 = layout.allBlocks.filter((b) => b.recordIndex === 11); // 第 12 筆
  assert.equal(rec11.length, 2);
  assert.ok(rec11.every((b) => b.pageIndex === 1 && b.slotIndex === 0));
  assert.deepEqual(validateLayout(layout), []);
});

test("最後一頁只輸出實際資料、不補空白（7 筆三區塊：5+2）", () => {
  const layout = buildTabletLayout("ANCESTOR_LINE", recs(7));
  assert.equal(layout.pages.length, 2);
  assert.equal(layout.pages[0].blocks.length, 15, "第 1 頁 5 筆");
  assert.equal(layout.pages[1].blocks.length, 6, "第 2 頁 2 筆（不補到 5 筆）");
  assert.deepEqual(validateLayout(layout), []);
});

test("V27.12：三區塊每一筆的地址/主文/陽上緊密成組（整組寬 ≤ 90mm，5 筆 0 違規）", () => {
  const layout = buildTabletLayout("ANCESTOR_LINE", recs(5));
  assert.deepEqual(validateLayout(layout), []);
  for (let r = 0; r < 5; r++) {
    const bs = layout.allBlocks.filter((b) => b.recordIndex === r);
    assert.equal(bs.length, 3, `rec${r} 應有 3 塊`);
    const minX = Math.min(...bs.map((b) => b.xMm));
    const maxX = Math.max(...bs.map((b) => b.xMm + b.widthMm));
    const minY = Math.min(...bs.map((b) => b.yMm));
    const maxY = Math.max(...bs.map((b) => b.yMm + b.heightMm));
    // 同一筆三塊的整體外框需夠緊密（同一格）：寬 ≤ 90mm、高 ≤ 95mm。
    assert.ok(maxX - minX <= 90, `rec${r} 整組寬 ${maxX - minX} 應 ≤ 90（成組，不散開）`);
    assert.ok(maxY - minY <= 95, `rec${r} 整組高 ${maxY - minY} 應 ≤ 95`);
  }
});

test("固定座標對應：第 i 筆的地址/主文字/陽上皆用第 slot 個座標", () => {
  const layout = buildTabletLayout("ANCESTOR_LINE", recs(5));
  const addr0 = layout.allBlocks.find((b) => b.recordIndex === 0 && b.blockType === "address")!;
  const main0 = layout.allBlocks.find((b) => b.recordIndex === 0 && b.blockType === "main")!;
  const yang0 = layout.allBlocks.find((b) => b.recordIndex === 0 && b.blockType === "yangshang")!;
  // V27.12：三區塊改為同一筆成組（第 0 格：地址 x3 / 主文 x20 / 陽上 x72，皆 y3，緊鄰同一格）。
  assert.deepEqual([addr0.xMm, addr0.yMm], [3, 3]);
  assert.deepEqual([main0.xMm, main0.yMm], [20, 3]);
  assert.deepEqual([yang0.xMm, yang0.yMm], [72, 3]);
  // 綁定值存在、且不作為列印文字。
  assert.equal(addr0.entryId, "e0");
  assert.equal(addr0.registrationId, "r0");
});

test("Offset：整頁一致套用；不改寬高/分頁/對應", () => {
  const base = buildTabletLayout("ANCESTOR_LINE", recs(5));
  const moved = buildTabletLayout("ANCESTOR_LINE", recs(5), { offsetXmm: 1, offsetYmm: 1 });
  for (let i = 0; i < base.allBlocks.length; i++) {
    assert.equal(moved.allBlocks[i].xMm, base.allBlocks[i].xMm + 1);
    assert.equal(moved.allBlocks[i].yMm, base.allBlocks[i].yMm + 1);
    assert.equal(moved.allBlocks[i].widthMm, base.allBlocks[i].widthMm);
    assert.equal(moved.allBlocks[i].heightMm, base.allBlocks[i].heightMm);
    assert.equal(moved.allBlocks[i].recordIndex, base.allBlocks[i].recordIndex);
  }
});

test("Offset 超界 → 阻擋（isOffsetWithinBounds false 且 validateLayout 有 OUT_OF_BOUNDS）", () => {
  // V27.12：三區塊成組後最下到 y289（第 3 列 195+94）、最右到 x194；+6mm(Y) → 295 > 294 超界。
  assert.equal(isOffsetWithinBounds("ANCESTOR_LINE", { offsetXmm: 0, offsetYmm: 6 }), false);
  const bad = buildTabletLayout("ANCESTOR_LINE", recs(5), { offsetXmm: 0, offsetYmm: 6 });
  assert.ok(validateLayout(bad).some((x) => x.code === "OUT_OF_BOUNDS"));
  // 合理小 offset（+1,+1）仍在界內。
  assert.equal(isOffsetWithinBounds("ANCESTOR_LINE", { offsetXmm: 1, offsetYmm: 1 }), true);
  assert.equal(isOffsetWithinBounds("DEBT_CREDITOR", { offsetXmm: 0, offsetYmm: 0 }), true);
});

test("驗證函式基本性質（boundary/gap）", () => {
  assert.equal(inBounds({ xMm: 3, yMm: 3, widthMm: 15, heightMm: 150 }), true);
  assert.equal(inBounds({ xMm: 3, yMm: 3, widthMm: 205, heightMm: 150 }), false); // 3+205=208>207
  // 剛好 1mm 間距 → OK；重疊 → 不 OK。
  assert.equal(gapOK({ xMm: 3, yMm: 3, widthMm: 15, heightMm: 150 }, { xMm: 19, yMm: 3, widthMm: 15, heightMm: 150 }), true);
  assert.equal(gapOK({ xMm: 3, yMm: 3, widthMm: 15, heightMm: 150 }, { xMm: 17, yMm: 3, widthMm: 15, heightMm: 150 }), false); // 3+15+1=19>17
  assert.equal(USABLE.x1, 207);
  assert.equal(BLOCK_SIZE.address.heightMm, 150);
});
