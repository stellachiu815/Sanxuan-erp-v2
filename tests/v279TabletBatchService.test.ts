import { test } from "node:test";
import assert from "node:assert/strict";
import {
  batchOf,
  classifySelection,
  summarizeBatchItems,
  buildTabletGroups,
  filterBatchItems,
  composeAncestorMainText,
  type BatchItem,
} from "../src/lib/TabletBatchService";

/**
 * V27.10：三批次列印服務層純函式測試（沙盒可跑）。
 * 驗證：批次歸屬、跨批次偵測、統計、依 documentType 分組。
 */
function item(p: Partial<BatchItem> & { id: string; itemType: string; sourceCategory: string }): BatchItem {
  return {
    sourceCategoryLabel: p.sourceCategory,
    sourceDisplayName: p.sourceDisplayName ?? "測試名",
    sourceLocation: p.sourceLocation ?? "台北市",
    sourceYangshangName: p.sourceYangshangName ?? "王小明",
    sourceYangshangNames: p.sourceYangshangNames ?? ["王小明"],
    tabletMissingFields: p.tabletMissingFields ?? [],
    status: p.status ?? "PENDING_PRINT",
    printCount: p.printCount ?? 0,
    household: p.household ?? { id: "F00001", name: "王家" },
    ...p,
  } as BatchItem;
}

test("batchOf：三批次歸屬正確（無緣子女歸祖先／乙位）", () => {
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "ANCESTOR_LINE" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "UNBORN_CHILD" }), "ancestor-soul");
  assert.equal(batchOf({ itemType: "TABLET", sourceCategory: "DEBT_CREDITOR" }), "creditor");
  assert.equal(batchOf({ itemType: "POCKET", sourceCategory: "ANCESTOR_LINE" }), "pocket");
});

test("classifySelection：祖先＋乙位可同批；跨批次回 MIXED", () => {
  const items = [
    item({ id: "a", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE" }),
    item({ id: "b", itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL" }),
    item({ id: "c", itemType: "TABLET", sourceCategory: "DEBT_CREDITOR" }),
    item({ id: "d", itemType: "POCKET", sourceCategory: "ANCESTOR_LINE" }),
  ];
  assert.equal(classifySelection(items, new Set(["a", "b"])), "ancestor-soul"); // 祖先＋乙位可混
  assert.equal(classifySelection(items, new Set(["a", "c"])), "MIXED"); // 祖先＋冤親 → 擋
  assert.equal(classifySelection(items, new Set(["c", "d"])), "MIXED"); // 冤親＋寶袋 → 擋
  assert.equal(classifySelection(items, new Set(["c"])), "creditor");
  assert.equal(classifySelection(items, new Set([])), null);
});

test("summarizeBatchItems：未列印/完整/不完整/已列印計數正確，且排除已取消", () => {
  const items = [
    item({ id: "1", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", printCount: 0, tabletMissingFields: [] }), // 未列印完整
    item({ id: "2", itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL", printCount: 0, tabletMissingFields: ["牌位地址"] }), // 未列印不完整
    item({ id: "3", itemType: "TABLET", sourceCategory: "UNBORN_CHILD", printCount: 2 }), // 已列印
    item({ id: "4", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", printCount: 0, status: "CANCELLED" }), // 排除
    item({ id: "5", itemType: "TABLET", sourceCategory: "DEBT_CREDITOR", printCount: 0 }), // 別批，不計
  ];
  const s = summarizeBatchItems(items, "ancestor-soul");
  assert.equal(s.unprintedTotal, 2);
  assert.equal(s.printableComplete, 1);
  assert.equal(s.incompleteCount, 1);
  assert.equal(s.printedCount, 1);
  assert.deepEqual(s.printableIds, ["1"]);
  assert.equal(s.incompleteDetails.length, 1);
  assert.equal(s.incompleteDetails[0].missing[0], "牌位地址");
});

test("buildTabletGroups：依 documentType 固定順序分組，僅含牌位", () => {
  const items = [
    item({ id: "1", itemType: "TABLET", sourceCategory: "DEBT_CREDITOR", sourceDisplayName: "冤親A" }),
    item({ id: "2", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", sourceDisplayName: "祖先A" }),
    item({ id: "3", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", sourceDisplayName: "祖先B" }),
  ];
  const groups = buildTabletGroups(items);
  assert.deepEqual(groups.map((g) => g.documentType), ["ANCESTOR_LINE", "DEBT_CREDITOR"]);
  assert.equal(groups[0].records.length, 2);
  // 歷代祖先主文會正名為○府歷代祖先（見 composeAncestorMainText）。
  assert.equal(groups[0].records[0].displayName, "祖先A府歷代祖先");
  assert.equal(groups[1].records.length, 1);
});

test("composeAncestorMainText：歷代祖先主文＝姓氏＋府＋歷代祖先（含截斷/複姓修正）", () => {
  assert.equal(composeAncestorMainText("蔡姓歷代祖先"), "蔡府歷代祖先");
  assert.equal(composeAncestorMainText("蔡姓"), "蔡府歷代祖先"); // 被截斷成「蔡姓」也修正
  assert.equal(composeAncestorMainText("蔡府歷代祖先"), "蔡府歷代祖先"); // 已正確 → 不變
  assert.equal(composeAncestorMainText("蔡歷代祖先"), "蔡府歷代祖先");
  assert.equal(composeAncestorMainText("歐陽姓歷代祖先"), "歐陽府歷代祖先"); // 複姓
  assert.equal(composeAncestorMainText("司馬府歷代祖先"), "司馬府歷代祖先");
});

test("buildTabletGroups：歷代祖先主文正名為○府歷代祖先，乙位/冤親不受影響", () => {
  const items = [
    item({ id: "1", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", sourceDisplayName: "蔡姓歷代祖先" }),
    item({ id: "2", itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL", sourceDisplayName: "林錦輝乙位正魂" }),
    item({ id: "3", itemType: "TABLET", sourceCategory: "DEBT_CREDITOR", sourceDisplayName: "累世冤親債主" }),
  ];
  const groups = buildTabletGroups(items);
  // V27.14：三區塊型合併同組（documentType 代表值 ANCESTOR_LINE）；冤親另一組。
  const threeBlock = groups.find((g) => g.documentType === "ANCESTOR_LINE")!;
  const debt = groups.find((g) => g.documentType === "DEBT_CREDITOR")!;
  assert.equal(groups.length, 2);
  assert.equal(threeBlock.records[0].displayName, "蔡府歷代祖先"); // 歷代祖先正名
  assert.equal(threeBlock.records[1].displayName, "林錦輝乙位正魂"); // 乙位正魂同組、主文不變
  assert.equal(debt.records[0].displayName, "累世冤親債主"); // 冤親不受影響
});

test("V27.14：混合三區塊型合併同組，每頁最多 5 筆（scope 與 ids 一致的分頁）", () => {
  const cats = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "UNBORN_CHILD"];
  const mk = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      item({ id: "id" + i, itemType: "TABLET", sourceCategory: cats[i % 3], sourceDisplayName: "名" + i })
    );
  // N 筆（含混合型別）→ 恆為 1 個 3-block 組、records=N（每頁 5 筆由 buildTabletLayout 分頁）。
  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const groups = buildTabletGroups(mk(n));
    assert.equal(groups.length, 1, `n=${n} 應只有 1 個 3-block 組`);
    assert.equal(groups[0].documentType, "ANCESTOR_LINE");
    assert.equal(groups[0].records.length, n, `n=${n} records 應為 ${n}`);
  }
});

test("filterBatchItems：只留該批次且可列印狀態", () => {
  const items = [
    item({ id: "1", itemType: "TABLET", sourceCategory: "ANCESTOR_LINE" }),
    item({ id: "2", itemType: "TABLET", sourceCategory: "DEBT_CREDITOR" }),
    item({ id: "3", itemType: "POCKET", sourceCategory: "ANCESTOR_LINE" }),
  ];
  assert.deepEqual(filterBatchItems(items, "ancestor-soul").map((i) => i.id), ["1"]);
  assert.deepEqual(filterBatchItems(items, "creditor").map((i) => i.id), ["2"]);
  assert.deepEqual(filterBatchItems(items, "pocket").map((i) => i.id), ["3"]);
});
