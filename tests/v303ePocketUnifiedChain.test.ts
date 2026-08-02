import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolvePrintItemRegistrationOrder,
  buildTabletGroups,
  type BatchItem,
} from "../src/lib/TabletBatchService";
import { formatWorkNumber } from "../src/components/ritual/tablets/shared";

/**
 * V30.3c 寶袋統一資料鏈（真實 mapping）測試。
 *
 * 這裡驗證的是 listPrintItemsForPrintCenter 對每一筆列印物件實際呼叫的
 * `resolvePrintItemRegistrationOrder(item, ctx)`——ctx 就是查詢建出的兩張 Map：
 *   tabletOrderByEntryId    = 牌位 entry → registrationOrder（TABLET 用）
 *   pocketRegistrationById  = AdditionalPrintItem.registrationItemId → { itemKey, registrationOrder }（POCKET 用）
 * 因此測試涵蓋 resolver 即等同涵蓋正式查詢的取號路徑（非直接塞 workNumber）。
 */

// ── 基本寶袋也有自己的 No.xxx，且與額外寶袋共用同一條 US_POCKET_EXTRA 序號序列 ──
test("基本寶袋與額外寶袋共用同一寶袋序號序列，各自顯示自己的 No.xxx", () => {
  // 同一活動：基本寶袋報名項目 order=1、額外寶袋報名項目 order=2（同為 US_POCKET_EXTRA 型別）。
  const pocketRegistrationById = new Map([
    ["reg-basic", { itemKey: "US_POCKET_EXTRA", registrationOrder: 1 }],
    ["reg-extra", { itemKey: "US_POCKET_EXTRA", registrationOrder: 2 }],
  ]);
  const ctx = { tabletOrderByEntryId: new Map<string, number | null>(), pocketRegistrationById };

  const basic = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-A", registrationItemId: "reg-basic" },
    ctx
  );
  const extra = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-A", registrationItemId: "reg-extra" },
    ctx
  );
  assert.equal(basic, 1, "基本寶袋取自身 US_POCKET_EXTRA order=1");
  assert.equal(extra, 2, "額外寶袋取自身 US_POCKET_EXTRA order=2");
  assert.equal(formatWorkNumber(basic), "No.001");
  assert.equal(formatWorkNumber(extra), "No.002");
});

// ── 依附祖先 order=3、寶袋自身 order=17：寶袋只能顯示 No.017，牌位顯示 No.003 ──
test("依附祖先=3、寶袋自身=17：寶袋 No.017、牌位 No.003，互不誤取", () => {
  const ctx = {
    tabletOrderByEntryId: new Map<string, number | null>([["entry-ancestor", 3]]),
    pocketRegistrationById: new Map([["reg-pocket", { itemKey: "US_POCKET_EXTRA", registrationOrder: 17 }]]),
  };
  const tablet = resolvePrintItemRegistrationOrder(
    { itemType: "TABLET", sourceEntryId: "entry-ancestor", registrationItemId: null },
    ctx
  );
  // 寶袋 sourceEntry 指向同一祖先 entry，但取號只看自身 registrationItemId → 17（不取 3）。
  const pocket = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-ancestor", registrationItemId: "reg-pocket" },
    ctx
  );
  assert.equal(formatWorkNumber(tablet), "No.003");
  assert.equal(formatWorkNumber(pocket), "No.017");
});

// ── registrationItemId=NULL（未連結）、依附祖先=3：寶袋不顯示號碼，不誤用牌位號 ──
test("寶袋 registrationItemId=NULL、依附祖先=3：寶袋不顯示 No.xxx", () => {
  const ctx = {
    tabletOrderByEntryId: new Map<string, number | null>([["entry-ancestor", 3]]),
    pocketRegistrationById: new Map<string, { itemKey: string; registrationOrder: number | null }>(),
  };
  const pocket = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-ancestor", registrationItemId: null },
    ctx
  );
  assert.equal(pocket, null);
  assert.equal(formatWorkNumber(pocket), null);
});

// ── 型別守門：registrationItemId 指到非 US_POCKET_EXTRA 報名項目 → 一律 null ──
test("registrationItemId 指到非 US_POCKET_EXTRA（如 US_ANCESTOR）→ 不顯示號碼", () => {
  const ctx = {
    tabletOrderByEntryId: new Map<string, number | null>(),
    pocketRegistrationById: new Map([["reg-wrong", { itemKey: "US_ANCESTOR", registrationOrder: 9 }]]),
  };
  const pocket = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-A", registrationItemId: "reg-wrong" },
    ctx
  );
  assert.equal(pocket, null, "非 US_POCKET_EXTRA 型別不得顯示號碼");
});

// ── 自身 registrationOrder=null（活動為 null 未取號）→ 維持 null ──
test("寶袋自身 registrationOrder=null（未取號）→ 維持 null", () => {
  const ctx = {
    tabletOrderByEntryId: new Map<string, number | null>(),
    pocketRegistrationById: new Map([["reg-nullorder", { itemKey: "US_POCKET_EXTRA", registrationOrder: null }]]),
  };
  const pocket = resolvePrintItemRegistrationOrder(
    { itemType: "POCKET", sourceEntryId: "entry-A", registrationItemId: "reg-nullorder" },
    ctx
  );
  assert.equal(pocket, null);
});

// ── 端到端：基本＋額外寶袋一起進 POCKET 批次，各自帶自己的 No.xxx ──
function pocketBatchItem(id: string, registrationOrder: number | null): BatchItem {
  return {
    id, itemType: "POCKET", registrationOrder, sourceCategory: "ANCESTOR_LINE",
    sourceCategoryLabel: "寶袋", sourceDisplayName: id, sourceLocation: null,
    sourceYangshangName: null, sourceYangshangNames: [], tabletMissingFields: [],
    status: "PENDING", printCount: 0, household: { id: "H", name: "戶" },
  };
}
test("POCKET 批次：基本(No.001)與額外(No.002)寶袋各自帶號一起列印", () => {
  const groups = buildTabletGroups([pocketBatchItem("basic", 1), pocketBatchItem("extra", 2)]);
  const pocket = groups.find((g) => g.documentType === "POCKET")!;
  assert.equal(pocket.records.length, 2);
  assert.equal(formatWorkNumber(pocket.records[0].workNumber), "No.001");
  assert.equal(formatWorkNumber(pocket.records[1].workNumber), "No.002");
});
