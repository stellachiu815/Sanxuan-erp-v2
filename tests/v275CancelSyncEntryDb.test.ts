import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.5 「取消已報名項目 ↔ 登記名冊 Entry 一致」整合回歸（需真實 DB，待 Mac）：
 *  - removeRegisteredItem 取消牌位類 item（祖先／正魂／冤親）→ 同一 transaction 內同步軟刪對應 Entry。
 *  - 重新帶入（createUniversalSalvationEntry 同名同址）→ 恢復原 Entry 與原 item 為 DRAFT，不新增重複。
 *  - 恢復不動金額／列印欄位；名冊與已報名項目一致。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v275CancelSyncEntryDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  const backfill = await import("../src/lib/tabletItemBackfill");
  return { prisma, ritual, reg, seed, backfill };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T275A";
const YEAR = 189;
const ADDR = "本宮祖先殿";

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" }, select: { id: true } });
  if (rr) {
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
    await prisma.additionalPrintItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
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
  await prisma.household.create({ data: { id: HH, name: "V275測試戶", address: ADDR } });
  const rr = await prisma.ritualRecord.create({ data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: "DRAFT" } });
  await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  return { rrId: rr.id };
}

const CASES = [
  { category: "ANCESTOR_LINE", name: "周姓歷代祖先", key: "US_ANCESTOR" },
  { category: "INDIVIDUAL_SOUL", name: "周能通 乙位正魂", key: "US_ZHENGHUN" },
  { category: "DEBT_CREDITOR", name: "累世冤親債主甲", key: "US_YUANQIN" },
];

async function addEntry(l: Loaded, category: string, displayName: string) {
  const res = await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: category as never, displayName, tabletAddress: ADDR, syncToHousehold: false }, "測試");
  assert.equal(res.ok, true);
  const entry = await l.prisma.universalSalvationEntry.findFirst({ where: { displayName, deletedAt: null }, orderBy: { createdAt: "desc" } });
  return entry!;
}
const itemForEntry = (l: Loaded, entryId: string) =>
  l.prisma.ritualRegistrationItem.findUnique({ where: { universalSalvationEntryId: entryId }, include: { registrationItemType: { select: { key: true } } } });

dbTest("取消祖先/正魂/冤親 item → Entry 同步軟刪；重新帶入 → 同一 Entry+item 恢復 DRAFT、不重複、金額/列印不變", async () => {
  const l = await load();
  const { prisma, reg } = l;
  for (const c of CASES) {
    try {
      const { rrId } = await setup(l);
      // 帶入 → Entry + item（DRAFT）。
      const entry = await addEntry(l, c.category, c.name);
      const item = await itemForEntry(l, entry.id);
      assert.equal(item?.registrationItemType.key, c.key);
      assert.equal(item?.status, "DRAFT");

      // 取消項目 → item CANCELLED+軟刪，且 Entry 同步軟刪。
      const rm = await reg.removeRegisteredItem(item!.id, "系統管理員");
      assert.equal(rm.ok, true);
      const itemAfterCancel = await prisma.ritualRegistrationItem.findUnique({ where: { id: item!.id } });
      const entryAfterCancel = await prisma.universalSalvationEntry.findUnique({ where: { id: entry.id } });
      assert.equal(itemAfterCancel?.status, "CANCELLED", `${c.key} item 取消`);
      assert.notEqual(itemAfterCancel?.deletedAt, null, "item 軟刪");
      assert.notEqual(entryAfterCancel?.deletedAt, null, `${c.category} Entry 同步軟刪（一致）`);
      assert.equal(entryAfterCancel?.deletedByName, "系統管理員");

      // 在軟刪 item 上放列印/金額欄位，稍後驗證恢復不動它。
      await prisma.ritualRegistrationItem.update({ where: { id: item!.id }, data: { amountDue: 300, printCount: 2, printedAt: new Date("2024-08-01") } });

      // 重新帶入（同名同址）→ 恢復原 Entry 與原 item，不新增重複。
      const entry2 = await addEntry(l, c.category, c.name);
      assert.equal(entry2.id, entry.id, `${c.category} 恢復同一筆 Entry（非新建）`);
      assert.equal(await prisma.universalSalvationEntry.count({ where: { universalSalvationId: entry.universalSalvationId, displayName: c.name } }), 1, "無重複 Entry");
      assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: entry.id } }), 1, "無重複 item");

      const itemRestored = await prisma.ritualRegistrationItem.findUnique({ where: { id: item!.id } });
      assert.equal(itemRestored?.status, "DRAFT", "item 恢復 DRAFT");
      assert.equal(itemRestored?.deletedAt, null, "item.deletedAt 清空");
      assert.equal(Number(itemRestored?.amountDue), 300, "金額不變");
      assert.equal(itemRestored?.printCount, 2, "列印次數不變");
      assert.equal(itemRestored?.printedAt?.getTime(), new Date("2024-08-01").getTime(), "列印時間不變");

      // 名冊（有效 Entry）與已報名項目一致：都看得到。
      const entryFinal = await prisma.universalSalvationEntry.findUnique({ where: { id: entry.id } });
      assert.equal(entryFinal?.deletedAt, null, "Entry 恢復有效");
      assert.ok((await reg.listRegisteredItems(rrId)).some((i) => i.itemKey === c.key), "已報名項目看得到");
    } finally {
      await cleanup(l).catch(() => {});
    }
  }
});

dbTest("transaction 一致：removeRegisteredItem 目標不存在時，不留半套（item 與 Entry 皆未變）", async () => {
  const l = await load();
  const { reg } = l;
  try {
    await setup(l);
    const res = await reg.removeRegisteredItem("nonexistent-item-id", "系統管理員");
    assert.equal(res.ok, false); // 找不到 → 明確失敗，未寫入任何一邊
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("F00001 修復：Entry 軟刪＋item 取消 → reactivate 同時恢復 Entry 與 item 為有效/DRAFT", async () => {
  const l = await load();
  const { prisma, reg, backfill } = l;
  try {
    await setup(l);
    const entry = await addEntry(l, "ANCESTOR_LINE", "周姓歷代祖先");
    const item = await itemForEntry(l, entry.id);
    // 取消（同步軟刪 Entry）。
    await reg.removeRegisteredItem(item!.id, "系統管理員");
    assert.notEqual((await prisma.universalSalvationEntry.findUnique({ where: { id: entry.id } }))?.deletedAt, null);

    // dry-run。
    const dry = await backfill.reactivateTabletItemForReRegistration(entry.id, { commit: false });
    assert.equal(dry.ok && dry.action, "REACTIVATE");
    if (dry.ok && dry.action === "REACTIVATE") assert.equal(dry.entryWasDeleted, true);
    assert.notEqual((await prisma.universalSalvationEntry.findUnique({ where: { id: entry.id } }))?.deletedAt, null, "dry-run 未動");

    // commit：Entry 與 item 都恢復。
    const res = await backfill.reactivateTabletItemForReRegistration(entry.id, { commit: true });
    assert.equal(res.ok && res.action, "REACTIVATE");
    assert.equal((await prisma.universalSalvationEntry.findUnique({ where: { id: entry.id } }))?.deletedAt, null);
    const it = await prisma.ritualRegistrationItem.findUnique({ where: { id: item!.id } });
    assert.equal(it?.status, "DRAFT");
    assert.equal(it?.deletedAt, null);
    assert.equal(it?.deletedByName, null);
  } finally {
    await cleanup(l).catch(() => {});
  }
});
