import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * V36.7：普渡名冊（buildItemRoster）與活動參加名單（ActivityParticipantRoster）改與 V34 共用
 * listPrintItemsForPrintCenter 為唯一來源；不再以 RitualRegistrationItem.status='CONFIRMED' 為普渡名冊來源。
 * 匯總計數（listActivityItemPrintSummary）已於 V36.8 統一。此處靜態驗證程式碼層護欄。
 */
const printDocs = readFileSync(new URL("../src/lib/printDocuments.ts", import.meta.url), "utf8");
const participant = readFileSync(new URL("../src/lib/activityParticipantRoster.ts", import.meta.url), "utf8");

test("buildItemRoster：普渡牌位／寶袋 key 走 listPrintItemsForPrintCenter，不再用 CONFIRMED", () => {
  assert.ok(printDocs.includes("US_TABLET_ROSTER_KEYS"), "普渡牌位 key 集合");
  assert.ok(/US_TABLET_ROSTER_KEYS\.has\(itemKey\)\s*\|\|\s*isUSPocket/.test(printDocs), "普渡牌位/寶袋分支");
  // 分支內以 listPrintItemsForPrintCenter 為來源。
  assert.ok(/isUSPocket\)\s*\{[\s\S]*?listPrintItemsForPrintCenter\(year/.test(printDocs), "普渡名冊來源＝V34 同一支查詢");
});

test("V36.7B：金額不再固定 0，改批次讀既有 RRI 裝飾；無對應 RRI 顯示 null（—）", () => {
  // 牌位以 universalSalvationEntryId 批次取 RRI；寶袋以自身 registrationItemId 取 US_POCKET_EXTRA RRI。
  assert.ok(/universalSalvationEntryId:\s*\{\s*in:\s*entryIds\s*\}/.test(printDocs), "牌位批次讀 RRI（universalSalvationEntryId IN）");
  assert.ok(/registrationItemId.*additional_print_items/s.test(printDocs) || printDocs.includes('"registrationItemId" AS "regId"'), "寶袋讀自身 registrationItemId");
  assert.ok(/id:\s*\{\s*in:\s*regIds\s*\}/.test(printDocs), "寶袋批次讀其 US_POCKET_EXTRA RRI 金額");
  // 找不到 RRI → null（不以 0 冒充）。
  assert.ok(/amt\s*\?\s*amt\.due\s*:\s*null/.test(printDocs), "無 RRI → amountDue=null（—）");
  // 不重新計算金額：只讀 amountDue/Paid/Unpaid（原樣 Number 轉型，無任何算式）。
  assert.ok(/Number\(rri\.amountDue\)/.test(printDocs) && /Number\(rri\.amountUnpaid\)/.test(printDocs), "沿用既有 amountDue/Unpaid，不重算");
  // RosterRow 金額型別可為 null。
  assert.ok(/amountDue:\s*number\s*\|\s*null/.test(printDocs), "RosterRow 金額可為 null");
});

test("listActivityItemPrintSummary：普渡計數＝列印物件（printObjectCountsByItemKey）", () => {
  assert.ok(printDocs.includes("printObjectCountsByItemKey"), "普渡計數用列印物件換算");
  assert.ok(printDocs.includes("listPrintItemsForPrintCenter"), "與 V34 同源");
});

test("ActivityParticipantRoster：牌位以 V34 有效牌位集合為準；非牌位（白米/贊普/寶袋）保留", () => {
  assert.ok(participant.includes("listPrintItemsForPrintCenter"), "牌位集合以 V34 為準");
  assert.ok(/validTabletEntryIds/.test(participant), "有效牌位集合");
  assert.ok(/universalSalvationEntryId == null \|\| validTabletEntryIds\.has/.test(participant), "非牌位項目不受影響、牌位對齊 V34");
});

test("非普渡活動項目仍維持 CONFIRMED 報名計數（未被破壞）", () => {
  assert.ok(/status:\s*"CONFIRMED"/.test(printDocs), "非普渡維持 CONFIRMED 報名計數");
});
