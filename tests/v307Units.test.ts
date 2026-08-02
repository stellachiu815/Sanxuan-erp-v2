import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRepairArgs } from "../src/lib/repairArgs";
import { rowSection, pocketDisplay, pocketAmountDue, summarizeAmounts, type DetailSection } from "../src/lib/registrationDetailShape";
import { verticalTextInnerStyle } from "../src/components/ritual/tablets/addressLayout";

/** V30.7 可在 sandbox 執行的純函式覆蓋：repair 參數、明細列形狀、地址內層樣式。 */

// ── repair 參數（Part 5）──
test("repair 預設 dry-run：無參數 → 全階段預覽、不寫入", () => {
  const a = parseRepairArgs([]);
  assert.equal(a.year, 115);
  assert.equal(a.writeEnabled, false);
  assert.deepEqual(a.stages, { restoreOrphans: true, confirmSafeDrafts: true, assignMissingOrders: true });
});

test("repair --commit 但未指定階段 → 仍不寫入（安全預設）", () => {
  const a = parseRepairArgs(["--commit"]);
  assert.equal(a.commit, true);
  assert.equal(a.explicitStages, false);
  assert.equal(a.writeEnabled, false, "未指定階段時，即使 --commit 也不寫入");
});

test("repair 指定單一階段 + --commit → 只該階段寫入", () => {
  const a = parseRepairArgs(["115", "--restore-orphans", "--commit"]);
  assert.equal(a.writeEnabled, true);
  assert.deepEqual(a.stages, { restoreOrphans: true, confirmSafeDrafts: false, assignMissingOrders: false });
});

test("repair 指定階段但無 --commit → 只預覽該階段、不寫入", () => {
  const a = parseRepairArgs(["--confirm-safe-drafts"]);
  assert.equal(a.writeEnabled, false);
  assert.deepEqual(a.stages, { restoreOrphans: false, confirmSafeDrafts: true, assignMissingOrders: false });
});

test("repair 指定年度可覆寫", () => {
  assert.equal(parseRepairArgs(["116", "--assign-missing-orders"]).year, 116);
});

// ── 明細列形狀（Part 3）──
test("rowSection：DRAFT/CANCELLED 不混入 ACTIVE", () => {
  assert.equal(rowSection("CONFIRMED"), "ACTIVE");
  assert.equal(rowSection("DRAFT"), "DRAFT");
  assert.equal(rowSection("CANCELLED"), "CANCELLED");
  assert.equal(rowSection("PENDING_PRINT"), "ACTIVE");
});

test("pocketDisplay：基本≠額外、免費≠收費（基本寶袋不得顯示成額外收費寶袋）", () => {
  assert.deepEqual(pocketDisplay(false, false), { kind: "BASIC", itemName: "基本寶袋", feeLabel: "免費" });
  assert.deepEqual(pocketDisplay(true, true), { kind: "EXTRA", itemName: "增加寶袋", feeLabel: "收費" });
  assert.deepEqual(pocketDisplay(true, false), { kind: "EXTRA", itemName: "增加寶袋", feeLabel: "免費" });
});

test("pocketAmountDue：收費＝小計；免費/基本＝0", () => {
  assert.equal(pocketAmountDue(true, 300), 300);
  assert.equal(pocketAmountDue(false, 300), 0);
  assert.equal(pocketAmountDue(false, 0), 0);
});

test("summarizeAmounts：只加總非取消列，取消歷史不計、不重複", () => {
  const rows: { section: DetailSection; amountDue: number; amountPaid: number; amountUnpaid: number }[] = [
    { section: "ACTIVE", amountDue: 300, amountPaid: 0, amountUnpaid: 300 },
    { section: "DRAFT", amountDue: 500, amountPaid: 0, amountUnpaid: 500 },
    { section: "CANCELLED", amountDue: 999, amountPaid: 999, amountUnpaid: 0 },
  ];
  assert.deepEqual(summarizeAmounts(rows), { amountDue: 800, amountPaid: 0, amountUnpaid: 800 });
});

// ── 地址內層樣式（Part 6）：測到的即實際 render 的 CSS ──
test("verticalTextInnerStyle：兩行地址→textAlign end；單行/主文→center；一律直式且 height100%", () => {
  const end = verticalTextInnerStyle("end", 16, true);
  assert.equal(end.textAlign, "end");
  assert.equal(end.writingMode, "vertical-rl");
  assert.equal(end.height, "100%");
  const center = verticalTextInnerStyle("center", 40, false);
  assert.equal(center.textAlign, "center");
  assert.equal(center.color, "#000", "主文不 soft → 黑");
});
