import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTabletGroups, type BatchItem } from "../src/lib/TabletBatchService";

/** V36.9：冤親主文固定「累世冤親債主」，報名人姓名落在陽上人欄，不得取代主文；不影響其他類別。 */

function item(p: Partial<BatchItem>): BatchItem {
  return {
    id: p.id ?? Math.random().toString(36).slice(2),
    registrationOrder: p.registrationOrder ?? 1,
    workOrder: p.workOrder ?? null,
    itemType: p.itemType ?? "TABLET",
    sourceCategory: p.sourceCategory ?? "DEBT_CREDITOR",
    sourceCategoryLabel: p.sourceCategoryLabel ?? "累世冤親債主",
    sourceDisplayName: p.sourceDisplayName ?? "周財寶",
    printMainText: p.printMainText ?? null,
    sourceLocation: p.sourceLocation ?? "台北市A路",
    sourceYangshangName: p.sourceYangshangName ?? null,
    sourceYangshangNames: p.sourceYangshangNames ?? [],
    tabletMissingFields: p.tabletMissingFields ?? [],
    status: p.status ?? "PENDING_PRINT",
    printCount: p.printCount ?? 0,
    household: p.household ?? { id: "F00001", name: "周家" },
  };
}

function debtRecords(items: BatchItem[]) {
  const g = buildTabletGroups(items).find((x) => x.documentType === "DEBT_CREDITOR");
  return g?.records ?? [];
}

test("周財寶：主文固定「累世冤親債主」、陽上人「周財寶」、維持地址", () => {
  const recs = debtRecords([
    item({ sourceDisplayName: "周財寶", sourceYangshangNames: ["周財寶"], sourceLocation: "台北市中山區" }),
  ]);
  assert.equal(recs.length, 1);
  assert.equal(recs[0].displayName, "累世冤親債主");
  assert.deepEqual(recs[0].yangshangNames, ["周財寶"]);
  assert.equal(recs[0].location, "台北市中山區");
});

test("陳秀珍：主文固定「累世冤親債主」、陽上人「陳秀珍」、各自地址", () => {
  const recs = debtRecords([
    item({ id: "a", sourceDisplayName: "周財寶", sourceYangshangNames: ["周財寶"], sourceLocation: "台北市" }),
    item({ id: "b", sourceDisplayName: "陳秀珍", sourceYangshangNames: ["陳秀珍"], sourceLocation: "新北市" }),
  ]);
  assert.equal(recs.length, 2);
  assert.ok(recs.every((r) => r.displayName === "累世冤親債主"), "兩筆主文皆固定");
  const chen = recs.find((r) => (r.yangshangNames ?? []).includes("陳秀珍"))!;
  assert.equal(chen.location, "新北市");
  const zhou = recs.find((r) => (r.yangshangNames ?? []).includes("周財寶"))!;
  assert.equal(zhou.location, "台北市");
});

test("冤親無陽上人陣列時，報名人姓名（entry 顯示名）退回陽上人欄，不落主文", () => {
  const recs = debtRecords([item({ sourceDisplayName: "王大明", sourceYangshangNames: [] })]);
  assert.equal(recs[0].displayName, "累世冤親債主");
  assert.deepEqual(recs[0].yangshangNames, ["王大明"]);
});

test("已正名為累世冤親債主的資料不會把主文塞進陽上人", () => {
  const recs = debtRecords([item({ sourceDisplayName: "累世冤親債主", sourceYangshangNames: ["周財寶"] })]);
  assert.equal(recs[0].displayName, "累世冤親債主");
  assert.deepEqual(recs[0].yangshangNames, ["周財寶"]); // 不會誤用「累世冤親債主」當陽上人
});

test("不影響歷代祖先／乙位正魂主文", () => {
  const g = buildTabletGroups([
    item({ itemType: "TABLET", sourceCategory: "ANCESTOR_LINE", sourceDisplayName: "王姓歷代祖先", sourceYangshangNames: ["王小明"] }),
    item({ itemType: "TABLET", sourceCategory: "INDIVIDUAL_SOUL", sourceDisplayName: "陳永成乙位正魂", sourceYangshangNames: ["陳大"] }),
  ]).find((x) => x.documentType === "ANCESTOR_LINE");
  const anc = g!.records.find((r) => (r.yangshangNames ?? []).includes("王小明"))!;
  assert.equal(anc.displayName, "王姓歷代祖先");
  const soul = g!.records.find((r) => (r.yangshangNames ?? []).includes("陳大"))!;
  assert.equal(soul.displayName, "陳永成乙位正魂");
});
