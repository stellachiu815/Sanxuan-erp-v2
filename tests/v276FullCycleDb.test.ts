import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.5 正式流程完整循環回歸（需真實 DB，待 Mac）：
 *   建立 → 取消 → 重新報名 → 取消 → 重新報名 → 重整 → 確認 → 重整
 * 祖先／乙位正魂／累世冤親三類，全部走正式函式（createUniversalSalvationEntry /
 * removeRegisteredItem / listRegisteredItems），不使用任何修復 script。
 *
 * 驗證：
 *  - 恢復後 amountDue / amountPaid / amountUnpaid 與第一次建立一致（amountUnpaid = amountDue − amountPaid，
 *    不再停在 0）。
 *  - 每次重新報名都恢復同一筆 Entry 與同一筆 item，不新增重複。
 *  - 重整（重新查詢）名冊與已報名項目一致。
 *  - 確認（DRAFT→CONFIRMED）後 item 不會被取消。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v276FullCycleDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  return { prisma, ritual, reg, seed };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T276A";
const YEAR = 187;
const ADDR = "本宮祖先殿";
const PRICE = 2500;

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
  await prisma.templeEvent.deleteMany({ where: { activityType: "UNIVERSAL_SALVATION", year: YEAR } }).catch(() => {});
}

async function setup(l: Loaded) {
  const { prisma, seed } = l;
  await cleanup(l);
  await seed.ensureRegistrationItemTypesSeeded();
  const ev = await prisma.templeEvent.create({
    data: { activityType: "UNIVERSAL_SALVATION", year: YEAR, name: "V276普渡", ancestorUnitPrice: PRICE, zhenghunUnitPrice: PRICE, yuanqinUnitPrice: PRICE },
  });
  await prisma.household.create({ data: { id: HH, name: "V276戶", address: ADDR } });
  const rr = await prisma.ritualRecord.create({ data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: "DRAFT", templeEventId: ev.id } });
  await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  return { rrId: rr.id };
}

const CASES = [
  { category: "ANCESTOR_LINE", name: "周姓歷代祖先", key: "US_ANCESTOR" },
  { category: "INDIVIDUAL_SOUL", name: "周能通 乙位正魂", key: "US_ZHENGHUN" },
  { category: "DEBT_CREDITOR", name: "累世冤親債主甲", key: "US_YUANQIN" },
];

async function reReport(l: Loaded, category: string, name: string) {
  const r = await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: category as never, displayName: name, tabletAddress: ADDR, syncToHousehold: false }, "系統管理員");
  assert.equal(r.ok, true);
}
const activeEntry = (l: Loaded, name: string) =>
  l.prisma.universalSalvationEntry.findFirst({ where: { displayName: name, deletedAt: null } });
const itemFor = (l: Loaded, entryId: string) =>
  l.prisma.ritualRegistrationItem.findUnique({ where: { universalSalvationEntryId: entryId }, include: { registrationItemType: { select: { key: true } } } });

async function assertHealthy(l: Loaded, c: { category: string; name: string; key: string }, entryId: string, expectStatus: "DRAFT" | "CONFIRMED") {
  const { prisma } = l;
  // 單一有效 Entry、單一 item、金額一致。
  assert.equal(await prisma.universalSalvationEntry.count({ where: { displayName: c.name, deletedAt: null } }), 1, `${c.category} 只有一筆有效 Entry`);
  assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: entryId } }), 1, `${c.category} 只有一筆 item`);
  const it = await itemFor(l, entryId);
  assert.equal(it?.registrationItemType.key, c.key);
  assert.equal(it?.status, expectStatus, `${c.category} status`);
  assert.equal(it?.deletedAt, null, `${c.category} item 有效`);
  assert.equal(Number(it?.amountDue), PRICE, `${c.category} amountDue`);
  assert.equal(Number(it?.amountPaid), 0);
  assert.equal(Number(it?.amountUnpaid), PRICE, `${c.category} amountUnpaid=amountDue（不為 0）`);
}

dbTest("完整循環：建立→取消→重報→取消→重報→重整→確認→重整（祖先/正魂/冤親一致）", async () => {
  const l = await load();
  const { prisma, reg, ritual } = l;
  try {
    const { rrId } = await setup(l);

    for (const c of CASES) {
      // 建立。
      await reReport(l, c.category, c.name);
      let e = (await activeEntry(l, c.name))!;
      await assertHealthy(l, c, e.id, "DRAFT");
      const firstEntryId = e.id;

      // 循環兩次：取消 → 重新報名。每次都應恢復同一筆 Entry 與 item、金額一致。
      for (let cycle = 1; cycle <= 2; cycle++) {
        const it = (await itemFor(l, e.id))!;
        assert.equal((await reg.removeRegisteredItem(it.id, "系統管理員")).ok, true);
        assert.notEqual((await prisma.universalSalvationEntry.findUnique({ where: { id: e.id } }))?.deletedAt, null, `第${cycle}次取消：Entry 同步軟刪`);

        await reReport(l, c.category, c.name);
        e = (await activeEntry(l, c.name))!;
        assert.equal(e.id, firstEntryId, `第${cycle}次重報：恢復同一筆 Entry（非新建）`);
        await assertHealthy(l, c, e.id, "DRAFT");
      }
    }

    // 重整（重新查詢）：名冊有效 Entry ↔ 已報名項目一致。
    const listed = await reg.listRegisteredItems(rrId);
    for (const c of CASES) {
      assert.ok(listed.some((i) => i.itemKey === c.key), `重整後已報名項目含 ${c.key}`);
      assert.equal(await prisma.universalSalvationEntry.count({ where: { displayName: c.name, deletedAt: null } }), 1);
    }

    // 確認（模擬 confirmRegistration 的項目行為：DRAFT→CONFIRMED，不取消）。
    await prisma.ritualRecord.update({ where: { id: rrId }, data: { status: "CONFIRMED" } });
    await prisma.ritualRegistrationItem.updateMany({ where: { ritualRecordId: rrId, deletedAt: null, status: "DRAFT" }, data: { status: "CONFIRMED" } });

    // 重整：確認後 item 仍在、未被取消、金額不變。
    for (const c of CASES) {
      const e = (await activeEntry(l, c.name))!;
      await assertHealthy(l, c, e.id, "CONFIRMED");
    }
    assert.equal((await reg.listRegisteredItems(rrId)).filter((i) => ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN"].includes(i.itemKey)).length, 3);

    // 確認後再取消→重報（record 已 CONFIRMED）：仍恢復同一筆、金額一致（沿用 create 初始化）。
    const anc = (await activeEntry(l, "周姓歷代祖先"))!;
    const ancItem = (await itemFor(l, anc.id))!;
    await reg.removeRegisteredItem(ancItem.id, "系統管理員");
    await reReport(l, "ANCESTOR_LINE", "周姓歷代祖先");
    const anc2 = (await activeEntry(l, "周姓歷代祖先"))!;
    assert.equal(anc2.id, anc.id, "確認後重報仍恢復同一筆");
    const it2 = await itemFor(l, anc2.id);
    assert.equal(it2?.deletedAt, null);
    assert.notEqual(it2?.status, "CANCELLED");
    assert.equal(Number(it2?.amountUnpaid), PRICE, "amountUnpaid 一致，不為 0");
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("地址漂移容錯：同名、地址不同的重新報名仍恢復同一筆（唯一同名軟刪 Entry）", async () => {
  const l = await load();
  const { prisma, reg, ritual } = l;
  try {
    await setup(l);
    await reReport(l, "INDIVIDUAL_SOUL", "周能通 乙位正魂");
    const e = (await activeEntry(l, "周能通 乙位正魂"))!;
    const it = (await itemFor(l, e.id))!;
    await reg.removeRegisteredItem(it.id, "系統管理員");
    // 用不同地址重新報名。
    const r = await ritual.createUniversalSalvationEntry(HH, YEAR, { category: "INDIVIDUAL_SOUL" as never, displayName: "周能通 乙位正魂", tabletAddress: "另一個地址", syncToHousehold: false }, "系統管理員");
    assert.equal(r.ok, true);
    const e2 = (await activeEntry(l, "周能通 乙位正魂"))!;
    assert.equal(e2.id, e.id, "同名唯一軟刪 Entry → 恢復同一筆，不新增重複");
    assert.equal(await prisma.universalSalvationEntry.count({ where: { displayName: "周能通 乙位正魂" } }), 1, "無重複 Entry");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
