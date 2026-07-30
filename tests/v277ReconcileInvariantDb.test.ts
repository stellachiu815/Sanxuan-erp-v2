import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.5 不變式自癒回歸（需真實 DB，待 Mac）：
 *  「有效 Entry ⇒ 必有一筆有效 item」。reconcileTabletItemsForRecord 針對
 *  - 有效 Entry + item 已取消/軟刪（舊版取消流程遺留：名冊有、已報名沒有）→ 恢復同一筆為有效。
 *  - 有效 Entry + 完全無 item → 建立 item。
 *  - 健康資料 → 零修復（healed=0）。
 *  祖先／乙位正魂／冤親三類，金額與正式建立一致（amountUnpaid=amountDue）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v277ReconcileInvariantDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  return { prisma, reg, seed };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T277A";
const YEAR = 185;
const PRICE = 2500;

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" }, select: { id: true } });
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
  await prisma.templeEvent.deleteMany({ where: { activityType: "UNIVERSAL_SALVATION", year: YEAR } }).catch(() => {});
}

async function setup(l: Loaded) {
  const { prisma, seed } = l;
  await cleanup(l);
  await seed.ensureRegistrationItemTypesSeeded();
  const ev = await prisma.templeEvent.create({ data: { activityType: "UNIVERSAL_SALVATION", year: YEAR, name: "V277", ancestorUnitPrice: PRICE, zhenghunUnitPrice: PRICE, yuanqinUnitPrice: PRICE } });
  await prisma.household.create({ data: { id: HH, name: "V277戶" } });
  const rr = await prisma.ritualRecord.create({ data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: "DRAFT", templeEventId: ev.id } });
  const usd = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  return { rrId: rr.id, usdId: usd.id };
}

const mkEntry = (l: Loaded, usdId: string, category: string, name: string) =>
  l.prisma.universalSalvationEntry.create({ data: { universalSalvationId: usdId, category: category as never, displayName: name } });
const itemFor = (l: Loaded, entryId: string) =>
  l.prisma.ritualRegistrationItem.findUnique({ where: { universalSalvationEntryId: entryId }, include: { registrationItemType: { select: { key: true } } } });

const CASES = [
  { category: "ANCESTOR_LINE", name: "周姓歷代祖先", key: "US_ANCESTOR" },
  { category: "INDIVIDUAL_SOUL", name: "周能通 乙位正魂", key: "US_ZHENGHUN" },
  { category: "DEBT_CREDITOR", name: "累世冤親債主甲", key: "US_YUANQIN" },
];

dbTest("reconcile：有效 Entry + 取消/軟刪 item → 恢復有效；amountUnpaid=amountDue（三類）", async () => {
  const l = await load();
  const { prisma, reg } = l;
  for (const c of CASES) {
    try {
      const { rrId, usdId } = await setup(l);
      const e = await mkEntry(l, usdId, c.category, c.name);
      await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: c.category, year: YEAR, status: "DRAFT", memberId: null }));
      const it = await itemFor(l, e.id);
      // 模擬舊版取消：item 取消+軟刪、amountUnpaid=0，但 Entry 仍有效。
      await prisma.ritualRegistrationItem.update({ where: { id: it!.id }, data: { status: "CANCELLED", deletedAt: new Date(), amountUnpaid: 0 } });

      const res = await reg.reconcileTabletItemsForRecord(rrId);
      assert.equal(res.healed, 1, `${c.category} 修復 1 筆`);
      const healed = await itemFor(l, e.id);
      assert.equal(healed?.status, "DRAFT");
      assert.equal(healed?.deletedAt, null, "item 恢復有效");
      assert.equal(Number(healed?.amountDue), PRICE);
      assert.equal(Number(healed?.amountUnpaid), PRICE, "amountUnpaid=amountDue（不為 0）");
      assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: e.id } }), 1, "不新增重複");
    } finally {
      await cleanup(l).catch(() => {});
    }
  }
});

dbTest("reconcile：有效 Entry 完全無 item → 建立；健康資料 → healed=0", async () => {
  const l = await load();
  const { prisma, reg } = l;
  try {
    const { rrId, usdId } = await setup(l);
    const e = await mkEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先"); // 無 item
    const r1 = await reg.reconcileTabletItemsForRecord(rrId);
    assert.equal(r1.healed, 1, "無 item 的有效 Entry → 建立");
    assert.equal((await itemFor(l, e.id))?.registrationItemType.key, "US_ANCESTOR");

    // 已健康 → 再跑不動。
    const r2 = await reg.reconcileTabletItemsForRecord(rrId);
    assert.equal(r2.healed, 0, "健康資料零修復");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
