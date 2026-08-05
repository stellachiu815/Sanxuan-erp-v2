import { test } from "node:test";
import assert from "node:assert/strict";
import { filterAndSortParticipantRows, type ParticipantItemRow } from "../src/lib/activityParticipantRosterFilter";

/** V36.1 活動參加名單：純函式篩選／排序（不碰 Prisma）。 */

function row(p: Partial<ParticipantItemRow>): ParticipantItemRow {
  return {
    itemId: p.itemId ?? Math.random().toString(36).slice(2),
    workNo: p.workNo ?? null,
    activityName: p.activityName ?? "民國 115 年中元普渡",
    itemTypeKey: p.itemTypeKey ?? "US_ANCESTOR",
    itemTypeName: p.itemTypeName ?? "歷代祖先",
    householdCode: p.householdCode ?? "F00001",
    householdName: p.householdName ?? "周家",
    registrantName: p.registrantName ?? "周財寶",
    content: p.content ?? "周姓歷代祖先",
    yangshang: p.yangshang ?? ["周財寶"],
    address: p.address ?? "台北市",
    addressSource: p.addressSource ?? "牌位地址",
    quantity: p.quantity ?? 1,
    amountDue: p.amountDue ?? 600,
    amountPaid: p.amountPaid ?? 0,
    amountUnpaid: p.amountUnpaid ?? 600,
    status: p.status ?? "DRAFT",
    printCount: p.printCount ?? 0,
    printedAt: p.printedAt ?? null,
    createdAt: p.createdAt ?? "2026-08-01T00:00:00.000Z",
  };
}

test("工作編號排序：null 一律排最後（升冪與降冪皆然）", () => {
  const rows = [row({ workNo: 3 }), row({ workNo: null }), row({ workNo: 1 })];
  assert.deepEqual(filterAndSortParticipantRows(rows, { sort: "workNoAsc" }).map((r) => r.workNo), [1, 3, null]);
  assert.deepEqual(filterAndSortParticipantRows(rows, { sort: "workNoDesc" }).map((r) => r.workNo), [3, 1, null]);
});

test("已收／未收篩選", () => {
  const rows = [row({ amountPaid: 600, amountUnpaid: 0 }), row({ amountPaid: 0, amountUnpaid: 600 })];
  assert.equal(filterAndSortParticipantRows(rows, { payment: "paid" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { payment: "unpaid" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { payment: "all" }).length, 2);
});

test("已列印／未列印篩選", () => {
  const rows = [row({ printCount: 0 }), row({ printCount: 2 })];
  assert.equal(filterAndSortParticipantRows(rows, { print: "printed" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { print: "unprinted" }).length, 1);
});

test("家戶編號／名稱／項目篩選", () => {
  const rows = [
    row({ householdCode: "F00001", householdName: "周家", itemTypeKey: "US_ANCESTOR" }),
    row({ householdCode: "F00002", householdName: "陳家", itemTypeKey: "US_YUANQIN" }),
  ];
  assert.equal(filterAndSortParticipantRows(rows, { householdCode: "F00002" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { householdName: "周" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { itemTypeKey: "US_YUANQIN" }).length, 1);
});

test("關鍵字搜尋：信眾／陽上人／主文", () => {
  const rows = [
    row({ registrantName: "周財寶", content: "周姓歷代祖先", yangshang: ["周財寶"] }),
    row({ registrantName: "陳秀珍", content: "累世冤親債主", yangshang: ["陳秀珍"] }),
  ];
  assert.equal(filterAndSortParticipantRows(rows, { keyword: "冤親" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { keyword: "周財寶" }).length, 1);
  assert.equal(filterAndSortParticipantRows(rows, { keyword: "陳秀珍" }).length, 1);
});

test("每一筆項目各自為一列，不因同家戶而合併", () => {
  const rows = [
    row({ itemId: "a", householdCode: "F00001", content: "周姓歷代祖先" }),
    row({ itemId: "b", householdCode: "F00001", content: "累世冤親債主" }),
  ];
  assert.equal(filterAndSortParticipantRows(rows, {}).length, 2);
});
