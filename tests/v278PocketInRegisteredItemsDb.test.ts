import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.6 額外寶袋唯讀併入「已報名項目」整合回歸（需真實 DB，待 Mac）。
 *
 * 只驗證「顯示」：寶袋仍以 AdditionalPrintItem 為唯一正式來源，listRegisteredItems 唯讀併入
 * 一列 US_POCKET_EXTRA（excludeFromTotal=true），不建立 RitualRegistrationItem、不重複收款。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v278PocketInRegisteredItemsDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  const pockets = await import("../src/lib/additionalPrintItems");
  return { prisma, reg, seed, pockets };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T278A";
const YEAR = 181;
const POCKET_PRICE = 300;
const ANCESTOR_PRICE = 2500;

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" }, select: { id: true } });
  if (rr) {
    await prisma.additionalPrintItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
    const usd = await prisma.universalSalvationDetail.findUnique({ where: { ritualRecordId: rr.id }, select: { id: true } });
    if (usd) {
      await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvationId: usd.id } }).catch(() => {});
      await prisma.universalSalvationDetail.delete({ where: { id: usd.id } }).catch(() => {});
    }
    await prisma.ritualRecord.delete({ where: { id: rr.id } }).catch(() => {});
  }
  await prisma.household.deleteMany({ where: { id: HH } }).catch(() => {});
  await prisma.templeEvent.deleteMany({ where: { activityType: "UNIVERSAL_SALVATION", year: YEAR } }).catch(() => {});
}

async function setup(l: Loaded) {
  const { prisma, seed } = l;
  await cleanup(l);
  await seed.ensureRegistrationItemTypesSeeded();
  const ev = await prisma.templeEvent.create({ data: { activityType: "UNIVERSAL_SALVATION", year: YEAR, name: "V278", ancestorUnitPrice: ANCESTOR_PRICE, pocketUnitPrice: POCKET_PRICE } });
  await prisma.household.create({ data: { id: HH, name: "V278戶" } });
  const rr = await prisma.ritualRecord.create({ data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: "DRAFT", templeEventId: ev.id } });
  const usd = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  const entry = await prisma.universalSalvationEntry.create({ data: { universalSalvationId: usd.id, category: "ANCESTOR_LINE" as never, displayName: "周姓歷代祖先" } });
  return { rrId: rr.id, entryId: entry.id };
}

const pocketRows = <T extends { itemKey: string }>(items: T[]): T[] => items.filter((i) => i.itemKey === "US_POCKET_EXTRA");

dbTest("新增寶袋 → 已報名項目出現、金額正確、不建 RitualRegistrationItem、不計入總計", async () => {
  const l = await load();
  const { prisma, reg, pockets } = l;
  try {
    const { rrId, entryId } = await setup(l);
    // 先給祖先一筆正式 item（驗證併入寶袋不影響它、且總計只含它）。
    await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null }));

    const created = await pockets.createAdditionalPrintItem(HH, YEAR, entryId, { itemType: "POCKET" as never, usesSourceName: false, customPrintName: "江士耀", quantity: 1, isExtra: true, isChargeable: true, unitPrice: POCKET_PRICE }, "測試");
    assert.equal(created.ok, true);

    const items = await reg.listRegisteredItems(rrId);
    const pk = pocketRows(items);
    assert.equal(pk.length, 1, "已報名項目出現一筆寶袋");
    assert.equal(pk[0].displayLabel, "增加寶袋｜江士耀");
    assert.equal(pk[0].amountDue, POCKET_PRICE);
    assert.equal(pk[0].amountPaid, 0);
    assert.equal(pk[0].amountUnpaid, POCKET_PRICE);
    assert.equal(pk[0].readOnlyLegacy, true, "唯讀，不提供取消");
    assert.equal(pk[0].excludeFromTotal, true, "不計入本次報名總計");

    // 不得建立 US_POCKET_EXTRA 的 RitualRegistrationItem。
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: rrId, registrationItemType: { key: "US_POCKET_EXTRA" } } }), 0);

    // 總計（模擬面板：排除 CANCELLED 與 excludeFromTotal）只含祖先 2500，不含寶袋。
    const active = items.filter((i) => i.status !== "CANCELLED" && !i.excludeFromTotal);
    assert.equal(active.reduce((s, i) => s + i.amountDue, 0), ANCESTOR_PRICE, "總計不因寶袋而增加");
    // 祖先仍在。
    assert.ok(items.some((i) => i.itemKey === "US_ANCESTOR"));
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("編輯寶袋 → 反映且不重複；取消 → 消失；恢復 → 重新出現", async () => {
  const l = await load();
  const { reg, pockets } = l;
  try {
    const { rrId, entryId } = await setup(l);
    const created = await pockets.createAdditionalPrintItem(HH, YEAR, entryId, { itemType: "POCKET" as never, usesSourceName: false, customPrintName: "江士耀", quantity: 1, isExtra: true, isChargeable: true, unitPrice: POCKET_PRICE }, "測試");
    assert.equal(created.ok, true);
    const itemId = created.ok ? created.item.id : "";

    // 編輯：數量 2 → 金額 600、名稱變更；仍只有一列（不重複）。
    const upd = await pockets.updateAdditionalPrintItem(HH, YEAR, entryId, itemId, { quantity: 2, customPrintName: "江士耀改" }, "測試");
    assert.equal(upd.ok, true);
    let pk = pocketRows(await reg.listRegisteredItems(rrId));
    assert.equal(pk.length, 1, "編輯後仍只有一列");
    assert.equal(pk[0].quantity, 2);
    assert.equal(pk[0].amountDue, POCKET_PRICE * 2);
    assert.equal(pk[0].displayLabel, "增加寶袋｜江士耀改");

    // 取消 → 消失。
    const cancel = await pockets.cancelAdditionalPrintItem(HH, YEAR, entryId, itemId, "測試");
    assert.equal(cancel.ok, true);
    assert.equal(pocketRows(await reg.listRegisteredItems(rrId)).length, 0, "取消後不顯示");

    // 恢復 → 重新出現。
    const restore = await pockets.restoreCancelledAdditionalPrintItem(HH, YEAR, entryId, itemId, "測試");
    assert.equal(restore.ok, true);
    pk = pocketRows(await reg.listRegisteredItems(rrId));
    assert.equal(pk.length, 1, "恢復後重新顯示");
    assert.equal(pk[0].amountDue, POCKET_PRICE * 2);
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("非收費寶袋顯示應收 0；只出現額外寶袋（isExtra=true），預設寶袋不列", async () => {
  const l = await load();
  const { prisma, reg, pockets } = l;
  try {
    const { rrId, entryId } = await setup(l);
    // 預設寶袋（isExtra=false）——不應出現在已報名項目。
    await prisma.additionalPrintItem.create({ data: { ritualRecordId: rrId, sourceEntryId: entryId, sourceEntryType: "UNIVERSAL_SALVATION_ENTRY", householdId: HH, itemType: "POCKET" as never, printName: "預設寶袋", usesSourceName: true, quantity: 1, status: "PENDING_PRINT", isExtra: false, isChargeable: false, isPaid: false } });
    // 額外、不收費寶袋 → 顯示、應收 0。
    const created = await pockets.createAdditionalPrintItem(HH, YEAR, entryId, { itemType: "POCKET" as never, usesSourceName: false, customPrintName: "免費寶袋", quantity: 3, isExtra: true, isChargeable: false }, "測試");
    assert.equal(created.ok, true);

    const pk = pocketRows(await reg.listRegisteredItems(rrId));
    assert.equal(pk.length, 1, "只列額外寶袋，不列預設寶袋");
    assert.equal(pk[0].displayLabel, "增加寶袋｜免費寶袋");
    assert.equal(pk[0].amountDue, 0, "不收費 → 應收 0");
    assert.equal(pk[0].amountUnpaid, 0);
  } finally {
    await cleanup(l).catch(() => {});
  }
});
