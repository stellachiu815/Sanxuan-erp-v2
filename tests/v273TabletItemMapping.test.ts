import { test, after } from "node:test";
import assert from "node:assert/strict";
import { ENTRY_CATEGORY_TO_ITEM_KEY } from "../src/lib/registrationItemRegistration";
import { DEFAULT_BACKFILL_CATEGORIES } from "../src/lib/tabletItemBackfill";

// 這些常數所在模組會在載入時建立全域 PrismaClient；純測試不查 DB，但需在結束時
// 主動關閉連線，避免（沙盒中 Mac 版 engine）在行程結束後才觸發非同步初始化錯誤。
after(async () => {
  try {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  } catch {
    /* 忽略 */
  }
});

/**
 * V27.3 純函式回歸：牌位分類 → 計價 item key 對映與 backfill 預設範圍。
 * 這鎖住「ensureLinkedTabletItem 的對映沒有 bug」——祖先/正魂/冤親各自對到正確 key，
 * 排除「對映錯誤導致不建 item」的可能，真正根因是建立當下 item type 未 seed。
 */

test("四類 Entry → item key 對映正確", () => {
  assert.equal(ENTRY_CATEGORY_TO_ITEM_KEY.ANCESTOR_LINE, "US_ANCESTOR");
  assert.equal(ENTRY_CATEGORY_TO_ITEM_KEY.INDIVIDUAL_SOUL, "US_ZHENGHUN");
  assert.equal(ENTRY_CATEGORY_TO_ITEM_KEY.DEBT_CREDITOR, "US_YUANQIN");
  assert.equal(ENTRY_CATEGORY_TO_ITEM_KEY.UNBORN_CHILD, "US_WUYUAN");
});

test("backfill 預設只補祖先與乙位正魂（冤親/無緣需人工判定是否重複）", () => {
  assert.deepEqual([...DEFAULT_BACKFILL_CATEGORIES].sort(), ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"]);
  assert.equal(DEFAULT_BACKFILL_CATEGORIES.includes("DEBT_CREDITOR" as never), false);
});
