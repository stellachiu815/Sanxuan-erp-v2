import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.3 牌位 item 建立/修復 整合回歸（需真實 DB，待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v273TabletItemBackfillDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  const backfill = await import("../src/lib/tabletItemBackfill");
  return { prisma, reg, seed, backfill };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T273A";
const YEAR = 193;

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({
    where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" },
    select: { id: true },
  });
  if (rr) {
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
    const usd = await prisma.universalSalvationDetail.findUnique({ where: { ritualRecordId: rr.id }, select: { id: true } });
    if (usd) {
      await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvationId: usd.id } }).catch(() => {});
      await prisma.universalSalvationDetail.delete({ where: { id: usd.id } }).catch(() => {});
    }
    await prisma.ritualRecord.delete({ where: { id: rr.id } }).catch(() => {});
  }
  await prisma.household.deleteMany({ where: { id: HH } }).catch(() => {});
}

async function setup(l: Loaded) {
  const { prisma, seed } = l;
  await cleanup(l);
  await seed.ensureRegistrationItemTypesSeeded();
  await prisma.household.create({ data: { id: HH, name: "V273測試戶" } });
  const rr = await prisma.ritualRecord.create({
    data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: "DRAFT" },
  });
  const usd = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  return { rrId: rr.id, usdId: usd.id };
}

const makeEntry = (l: Loaded, usdId: string, category: string, displayName: string) =>
  l.prisma.universalSalvationEntry.create({ data: { universalSalvationId: usdId, category: category as never, displayName } });

const itemFor = (l: Loaded, entryId: string) =>
  l.prisma.ritualRegistrationItem.findUnique({
    where: { universalSalvationEntryId: entryId },
    include: { registrationItemType: { select: { key: true } } },
  });

dbTest("1-4/6: 各類 Entry 建對應 item、冪等、listRegisteredItems 顯示祖先與正魂", async () => {
  const l = await load();
  const { prisma, reg } = l;
  try {
    const { rrId, usdId } = await setup(l);
    const anc = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先");
    const soul = await makeEntry(l, usdId, "INDIVIDUAL_SOUL", "周能通 乙位正魂");
    const debt = await makeEntry(l, usdId, "DEBT_CREDITOR", "累世冤親債主");
    for (const e of [anc, soul, debt]) {
      await prisma.$transaction((tx) =>
        reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: e.category, year: YEAR, status: "DRAFT", memberId: null })
      );
    }
    assert.equal((await itemFor(l, anc.id))?.registrationItemType.key, "US_ANCESTOR");
    assert.equal((await itemFor(l, soul.id))?.registrationItemType.key, "US_ZHENGHUN");
    assert.equal((await itemFor(l, debt.id))?.registrationItemType.key, "US_YUANQIN");

    // 4：重跑不重複。
    await prisma.$transaction((tx) =>
      reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: anc.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null })
    );
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: anc.id } }), 1);

    // 6：listRegisteredItems 顯示祖先與乙位正魂。
    const keys = (await reg.listRegisteredItems(rrId)).map((i) => i.itemKey);
    assert.ok(keys.includes("US_ANCESTOR") && keys.includes("US_ZHENGHUN"));
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("scan: 1 筆孤立 ANCESTOR（完全無 item）→ 回 1；householdCode 過濾正確；無 soul 不虛構", async () => {
  const l = await load();
  const { backfill } = l;
  try {
    const { usdId } = await setup(l);
    const anc = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先"); // 不建 item → 孤立
    // 2. 傳 householdId=F00001 型別（此系統 Household.id 即家戶編號）過濾正確。
    const orphans = await backfill.findOrphanTabletEntries({ householdId: HH });
    assert.equal(orphans.length, 1, "只有 1 筆孤立 ANCESTOR");
    assert.equal(orphans[0].entryId, anc.id);
    assert.equal(orphans[0].category, "ANCESTOR_LINE");
    assert.equal(orphans[0].hasInactiveItem, false, "完全無 item 列");
    // 換一個不存在的家戶編號 → 0（證明有依 householdId 過濾）。
    assert.equal((await backfill.findOrphanTabletEntries({ householdId: "NOPE" })).length, 0);

    // 無 INDIVIDUAL_SOUL Entry → dry-run 不得虛構建立正魂 item。
    const dry = await backfill.backfillMissingTabletItems({ householdId: HH, commit: false });
    assert.equal(dry.committed, false);
    assert.equal(dry.orphans.some((o) => o.category === "INDIVIDUAL_SOUL"), false, "沒有正魂 Entry → 不出現正魂孤立");
    assert.equal(dry.created.length, 0, "dry-run 不建立任何 item");
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("restore: 軟刪 item 可恢復、金額/付款/收據/列印不變、listRegisteredItems 看得到、重跑不重複", async () => {
  const l = await load();
  const { prisma, reg, backfill } = l;
  try {
    const { rrId, usdId } = await setup(l);
    const anc = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先");
    await prisma.$transaction((tx) =>
      reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: anc.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null })
    );
    const it = await itemFor(l, anc.id);
    // 設定金額/付款/收據/列印欄位並軟刪＋取消（模擬 F00001 現況）。
    await prisma.ritualRegistrationItem.update({
      where: { id: it!.id },
      data: {
        amountDue: 300, amountPaid: 300, amountUnpaid: 0,
        status: "CANCELLED", printCount: 2, printedAt: new Date("2024-08-01T00:00:00Z"),
        deletedAt: new Date(), deletedByName: "系統：牌位刪除連動",
      },
    });
    const before = await prisma.ritualRegistrationItem.findUnique({ where: { id: it!.id } });

    // scan 判為孤立（無有效 item）、標 hasInactiveItem。
    const orphans = await backfill.findOrphanTabletEntries({ householdId: HH });
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].hasInactiveItem, true);

    // dry-run plan＝RESTORE，不寫入。
    const dry = await backfill.backfillMissingTabletItems({ householdId: HH, commit: false });
    assert.equal(dry.plan.find((p) => p.entry.entryId === anc.id)?.action, "RESTORE");
    assert.equal(dry.restored.length, 0, "dry-run 不寫入");
    const stillDeleted = await prisma.ritualRegistrationItem.findUnique({ where: { id: it!.id } });
    assert.notEqual(stillDeleted?.deletedAt, null, "dry-run 未動 deletedAt");

    // commit：恢復（只清 deletedAt/deletedByName）。
    const res = await backfill.backfillMissingTabletItems({ householdId: HH, commit: true });
    assert.deepEqual(res.restored, [anc.id]);
    assert.equal(res.created.length, 0, "恢復不走新建");
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: anc.id } }), 1, "沒有多建一筆");

    const after = await prisma.ritualRegistrationItem.findUnique({ where: { id: it!.id } });
    assert.equal(after?.deletedAt, null, "deletedAt 已清");
    assert.equal(after?.deletedByName, null, "deletedByName 已清");
    // 其餘欄位完全不變。
    assert.equal(Number(after?.amountDue), 300);
    assert.equal(Number(after?.amountPaid), 300);
    assert.equal(Number(after?.amountUnpaid), 0);
    assert.equal(after?.status, before?.status, "status 保留原值（不改成 CONFIRMED/DRAFT）");
    assert.equal(after?.printCount, 2, "列印次數不變");
    assert.equal(after?.printedAt?.getTime(), before?.printedAt?.getTime(), "列印時間不變");
    assert.equal(after?.registrationItemTypeId, before?.registrationItemTypeId);
    assert.equal(after?.ritualRecordId, before?.ritualRecordId);
    assert.equal(after?.universalSalvationEntryId, before?.universalSalvationEntryId);
    assert.equal(after?.createdAt?.getTime(), before?.createdAt?.getTime(), "createdAt 不變");

    // listRegisteredItems 看得到祖先。
    assert.ok((await reg.listRegisteredItems(rrId)).some((i) => i.itemKey === "US_ANCESTOR"));

    // 重跑：已有有效 item → 不再是孤立、不重複處理。
    const rerun = await backfill.backfillMissingTabletItems({ householdId: HH, commit: true });
    assert.equal(rerun.scanned, 0);
    assert.equal(rerun.restored.length, 0);
    assert.equal(rerun.created.length, 0);
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("commit: 補完全無 item 的孤立 Entry；不影響既有付款/確認；預設排除冤親、include-debt 才納入", async () => {
  const l = await load();
  const { prisma, reg, backfill } = l;
  try {
    const { rrId, usdId } = await setup(l);
    // 已有有效 item 且已收款的祖先（驗證 backfill 不動它）。
    const paid = await makeEntry(l, usdId, "ANCESTOR_LINE", "陳姓歷代祖先");
    await prisma.$transaction((tx) =>
      reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: paid.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null })
    );
    const paidItem = await itemFor(l, paid.id);
    await prisma.ritualRegistrationItem.update({ where: { id: paidItem!.id }, data: { amountPaid: 100, status: "CONFIRMED" } });

    // 完全無 item 的孤立祖先 + 一筆孤立冤親。
    const orphanAnc = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先");
    const orphanDebt = await makeEntry(l, usdId, "DEBT_CREDITOR", "累世冤親債主");

    // 預設（不含冤親）commit：只補祖先，不碰冤親。
    const res = await backfill.backfillMissingTabletItems({ householdId: HH, commit: true });
    assert.deepEqual(res.created, [orphanAnc.id], "只補孤立祖先");
    assert.equal((await itemFor(l, orphanAnc.id))?.registrationItemType.key, "US_ANCESTOR");
    assert.equal(await itemFor(l, orphanDebt.id), null, "預設不補冤親");

    // 既有付款/確認未被更動。
    const paidAfter = await prisma.ritualRegistrationItem.findUnique({ where: { id: paidItem!.id } });
    assert.equal(Number(paidAfter?.amountPaid), 100);
    assert.equal(paidAfter?.status, "CONFIRMED");

    // include-debt 才納入孤立冤親。
    const withDebt = await backfill.backfillMissingTabletItems({ householdId: HH, categories: ["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR"], commit: true });
    assert.equal(withDebt.created.includes(orphanDebt.id), true);
    assert.equal((await itemFor(l, orphanDebt.id))?.registrationItemType.key, "US_YUANQIN");

    // 重跑不重複（祖先已補，再跑不再建）。
    const rerun = await backfill.backfillMissingTabletItems({ householdId: HH, commit: true });
    assert.equal(rerun.created.length, 0);
  } finally {
    await cleanup(l).catch(() => {});
  }
});
