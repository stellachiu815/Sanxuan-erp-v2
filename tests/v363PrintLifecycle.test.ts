import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  batchOf,
  isComplete,
  isUnprinted,
  isPrintableStatus,
  shouldExcludeLeakedPrintSource,
} from "../src/lib/TabletBatchService";
import { expandPrintObjects, filterAndSortPrintObjectRows, type PrintObjectBase } from "../src/lib/printObjectRosterFilter";

/** V36.3 §三＋§六：有效／取消／封存 與 列印物件名單（純函式＋靜態驗證）。 */

// ── §三：排除規則 ──
test("有效 Entry＋有效 RegistrationItem → 出現；CANCELLED／已刪除／封存 → 排除", () => {
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "CONFIRMED" }), false);
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemStatus: "CANCELLED" }), true);
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, registrationItemDeleted: true }), true);
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: true, sourceDeletedAt: new Date() }), true);
  assert.equal(shouldExcludeLeakedPrintSource({ sourceExists: false }), true); // 封存牌位查詢已濾掉
});

test("缺地址阻擋列印，但資料不消失（isComplete=false 只是不完整，非刪除）", () => {
  assert.equal(isComplete({ tabletMissingFields: ["牌位地址"] }), false);
  assert.equal(isComplete({ tabletMissingFields: [] }), true);
  // 完整度只影響「是否可列印」，資料本身仍在（不由此函式刪除）。
});

test("batchOf：TABLET 與 POCKET 分開；祖先/乙位/無緣→ancestor-soul、冤親→creditor、寶袋→pocket", () => {
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "ANCESTOR_LINE" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "UNBORN_CHILD" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "DEBT_CREDITOR" }), "creditor");
  assert.equal(batchOf({ itemType: "POCKET", sourceCategory: "ANCESTOR_LINE" }), "pocket");
});

test("CANCELLED／PENDING_CONFIRMATION 非可列印狀態", () => {
  assert.equal(isPrintableStatus("CONFIRMED"), true);
  assert.equal(isPrintableStatus("CANCELLED"), false);
  assert.equal(isPrintableStatus("PENDING_CONFIRMATION"), false);
});

// ── §六：一份實體列印物件一列 ──
const base = (p: Partial<PrintObjectBase>): PrintObjectBase => ({
  objectId: p.objectId ?? Math.random().toString(36).slice(2), workNo: p.workNo ?? null,
  activityName: "普渡", itemType: p.itemType ?? "TABLET", typeKey: p.typeKey ?? "TABLET:ANCESTOR_LINE", typeLabel: "牌位",
  householdId: p.householdId ?? "F1", householdCode: p.householdCode ?? "F1", householdName: "家", registrantName: "人",
  mainText: p.mainText ?? "王姓歷代祖先", yangshang: [], address: null, firstPrintedAt: null, lastPrintedAt: null,
  printCount: p.printCount ?? 0, quantity: p.quantity ?? 1, printedQuantity: p.printedQuantity ?? 0,
  reportStatus: "CONFIRMED", createdAt: "2026-08-01T00:00:00.000Z", previewHref: "/p",
});

test("數量 5 的寶袋 → 展開 5 份，前 printedQuantity 份為已列印", () => {
  const rows = expandPrintObjects([base({ itemType: "POCKET", typeKey: "POCKET", quantity: 5, printedQuantity: 2 })]);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows.map((r) => r.copyPrinted), [true, true, false, false, false]);
});

test("已列印／未列印判定；作業編號空值排最後；同家戶不同物件不合併", () => {
  const rows = expandPrintObjects([
    base({ objectId: "a", workNo: 2, householdCode: "F1", mainText: "甲" }),
    base({ objectId: "b", workNo: null, householdCode: "F1", mainText: "乙" }),
    base({ objectId: "c", workNo: 1, householdCode: "F1", itemType: "POCKET", typeKey: "POCKET" }),
  ]);
  const sorted = filterAndSortPrintObjectRows(rows, { sort: "workNoAsc" });
  assert.deepEqual(sorted.map((r) => r.workNo), [1, 2, null]); // 空值殿後
  assert.equal(filterAndSortPrintObjectRows(rows, { householdCode: "F1" }).length, 3); // 同戶三物件各自成列
});

// ── 靜態驗證：正式查詢已落實封存/取消排除與封存連動（V34.3B） ──
test("listPrintItemsForPrintCenter 已加封存/取消排除（V34.3B）", () => {
  const src = readFileSync(new URL("../src/lib/additionalPrintItems.ts", import.meta.url), "utf8");
  assert.ok(/id:\s*\{\s*in:\s*sourceEntryIds\s*\},\s*deletedAt:\s*null/.test(src), "來源牌位查詢需加 deletedAt:null");
  assert.ok(src.includes("shouldExcludeLeakedPrintSource"), "組裝需以純函式排除孤立來源");
});

test("封存牌位連動軟刪其預設列印物件（V34.3B）＋ 重新報名恢復同一筆", () => {
  const ritual = readFileSync(new URL("../src/lib/ritual.ts", import.meta.url), "utf8");
  assert.ok(/additionalPrintItem\.updateMany\(\{[\s\S]*?isExtra:\s*false[\s\S]*?deletedAt:\s*new Date\(\)/.test(ritual), "封存牌位需連動軟刪預設列印物件");
  const api = readFileSync(new URL("../src/lib/additionalPrintItems.ts", import.meta.url), "utf8");
  assert.ok(api.includes("softTablet") && api.includes("softPocket"), "ensureTabletPrintObjects 需能恢復封存的同一筆（不重複建立）");
});

test("活動參加名單查詢排除封存/刪除資料（靜態）", () => {
  const src = readFileSync(new URL("../src/lib/activityParticipantRoster.ts", import.meta.url), "utf8");
  assert.ok(/deletedAt:\s*null/.test(src), "報名項目與 ritualRecord 需排除已刪除");
  assert.ok(src.includes("printNumberOf"), "作業編號需用 workOrder ?? registrationOrder（printNumberOf）");
});
