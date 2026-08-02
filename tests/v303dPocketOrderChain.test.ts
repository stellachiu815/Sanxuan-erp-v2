import { test } from "node:test";
import assert from "node:assert/strict";
import { registrationOrderForPrintItem, buildTabletGroups, type BatchItem } from "../src/lib/TabletBatchService";
import { formatWorkNumber } from "../src/components/ritual/tablets/shared";

/**
 * V30.3 寶袋作業號碼資料鏈防誤取。
 *
 * 背景（追查結論）：POCKET AdditionalPrintItem 的 sourceEntryId 指向它「所依附的牌位」
 * UniversalSalvationEntry，因此若沿用牌位那條 `universalSalvationEntryId = sourceEntryId`
 * join，寶袋會誤取到祖先／乙位正魂／冤親／無緣的 registrationOrder。
 * 修正：registrationOrderForPrintItem 只讓 TABLET 取號；POCKET 一律 null（不 fallback 牌位）。
 */

// ── 1. 純函式層：牌位取號、寶袋絕不沿用牌位號 ────────────────────────────
test("registrationOrderForPrintItem：TABLET 取牌位自身順序", () => {
  assert.equal(registrationOrderForPrintItem("TABLET", 3), 3);
  assert.equal(registrationOrderForPrintItem("TABLET", null), null);
});

test("registrationOrderForPrintItem：POCKET 絕不沿用依附牌位順序（防誤取 No.003）", () => {
  // 情境：寶袋所依附的祖先 registrationOrder=3；寶袋不得取到 3。
  assert.equal(registrationOrderForPrintItem("POCKET", 3), null);
  assert.equal(registrationOrderForPrintItem("POCKET", 17), null);
});

test("registrationOrderForPrintItem：POCKET 自身無順序連結 → 維持 null（不誤用牌位號碼）", () => {
  assert.equal(registrationOrderForPrintItem("POCKET", null), null);
});

// ── 2. 端到端：牌位 No.003 與寶袋 No.017 不同，寶袋印自身 017、牌位印 003 ──
function item(id: string, itemType: string, sourceCategory: string, registrationOrder: number | null): BatchItem {
  return {
    id, itemType, registrationOrder, sourceCategory,
    sourceCategoryLabel: sourceCategory, sourceDisplayName: id, sourceLocation: null,
    sourceYangshangName: null, sourceYangshangNames: [], tabletMissingFields: [],
    status: "PENDING", printCount: 0, household: { id: "H", name: "戶" },
  };
}

test("牌位順序 003 與寶袋自身順序 017 各自獨立：寶袋印 No.017、牌位印 No.003", () => {
  // 祖先牌位 registrationOrder=3；寶袋帶「自身」registrationOrder=17（非依附牌位的 3）。
  const groups = buildTabletGroups([
    item("ancestor1", "TABLET", "ANCESTOR_LINE", 3),
    item("pocket1", "POCKET", "ANCESTOR_LINE", 17),
  ]);
  const tablet = groups.find((g) => g.documentType === "ANCESTOR_LINE")!;
  const pocket = groups.find((g) => g.documentType === "POCKET")!;
  assert.equal(formatWorkNumber(tablet.records[0].workNumber), "No.003");
  assert.equal(formatWorkNumber(pocket.records[0].workNumber), "No.017", "寶袋印自身 017，非牌位 003");
});

test("寶袋自身順序 NULL、依附牌位有順序：寶袋不顯示 No.xxx，不誤用牌位號碼", () => {
  // 模擬修正後結果：listPrintItemsForPrintCenter 對 POCKET 一律回 null（即使依附祖先=3）。
  const pocketOrder = registrationOrderForPrintItem("POCKET", 3); // = null
  const groups = buildTabletGroups([
    item("ancestor1", "TABLET", "ANCESTOR_LINE", 3),
    item("pocket1", "POCKET", "ANCESTOR_LINE", pocketOrder),
  ]);
  const pocket = groups.find((g) => g.documentType === "POCKET")!;
  assert.equal(pocket.records[0].workNumber ?? null, null);
  assert.equal(formatWorkNumber(pocket.records[0].workNumber), null, "NULL → 不印作業號碼");
});
