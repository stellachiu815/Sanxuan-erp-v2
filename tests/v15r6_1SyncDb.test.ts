import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R6.1 普渡新增／修改牌位同步家戶永久名單（WorshipRecord）——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r6_1SyncDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const ritual = await import("../src/lib/ritual");
  const reg = await import("../src/lib/registrationItemRegistration");
  return { prisma, templeEvents, ritual, reg };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const TABLET_UNIT = 2500;
const SUITE = "T61"; // Household.id VarChar(10)：T61+4=7 字元
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function usItemId(prisma: P, key: string) {
  const row = await prisma.registrationItemType.findFirst({ where: { key }, select: { id: true } });
  return row!.id;
}

async function createEvent(templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"], year: number) {
  const ev = await templeEvents.createTempleEvent({ activityType: "UNIVERSAL_SALVATION", year }, "測試");
  assert.equal(ev.ok, true, ev.ok ? "" : `建立普渡活動失敗：${ev.error}`);
  if (ev.ok) {
    await templeEvents.updateTempleEventTabletPrices(
      ev.data.id,
      { ancestorUnitPrice: TABLET_UNIT, zhenghunUnitPrice: TABLET_UNIT, yuanqinUnitPrice: TABLET_UNIT, wuyuanUnitPrice: TABLET_UNIT },
      "測試"
    );
  }
}

async function setup(prisma: P, templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"], year: number, hhId: string) {
  await cleanup(prisma, [year, year + 1], hhId);
  await createEvent(templeEvents, year);
  const hh = await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
  const m = await prisma.member.create({ data: { householdId: hh.id, name: "邱明宏", isPrimaryContact: true } });
  return { hh, m };
}

async function worshipOf(prisma: P, hhId: string, type?: "ANCESTOR_LINE" | "INDIVIDUAL") {
  return prisma.worshipRecord.findMany({
    where: { householdId: hhId, ...(type ? { type } : {}) },
    orderBy: { createdAt: "asc" },
  });
}
async function entriesOf(prisma: P, year: number, category: string) {
  return prisma.universalSalvationEntry.findMany({
    where: { deletedAt: null, category: category as never, universalSalvation: { ritualRecord: { year } } },
    include: { registrationItem: { select: { amountPaid: true } } },
    orderBy: { createdAt: "asc" },
  });
}

async function cleanup(prisma: P, years: number[], hhId: string) {
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { year: { in: years } } } } });
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.ritualRecord.deleteMany({ where: { year: { in: years } } });
  await prisma.worshipRecord.deleteMany({ where: { householdId: hhId } });
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  await prisma.household.deleteMany({ where: { id: hhId } });
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year: { in: years } } } });
  await prisma.templeEvent.deleteMany({ where: { year: { in: years } } });
}

// A：手動新增祖先（syncToHousehold=true）→ 家戶永久名單同步出現、entry 連結、amountPaid=0。
dbTest("A 新增祖先同步永久名單：WorshipRecord 出現、entry.worshipRecordId 連結、amountPaid=0", async () => {
  const { prisma, templeEvents, ritual } = await load();
  const year = 9631;
  const hhId = hhIdFor(year);
  try {
    await setup(prisma, templeEvents, year, hhId);
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    const res = await ritual.createUniversalSalvationEntry(
      hhId, year,
      { category: "ANCESTOR_LINE", displayName: "陳姓歷代祖先", yangshangNames: ["陳大"], tabletAddress: "祖先路5號", syncToHousehold: true },
      "測試"
    );
    assert.equal(res.ok, true, res.ok ? "" : `新增失敗：${res.error}`);

    const wr = await worshipOf(prisma, hhId, "ANCESTOR_LINE");
    assert.equal(wr.length, 1, "永久名單同步出現 1 筆祖先");
    assert.equal(wr[0].displayName, "陳姓歷代祖先");
    assert.equal(wr[0].location, "祖先路5號");
    assert.equal(wr[0].yangshangName, "陳大");

    const e = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(e.length, 1);
    assert.equal((e[0] as { worshipRecordId: string | null }).worshipRecordId, wr[0].id, "entry 連結到永久名單");
    assert.equal(Number(e[0].registrationItem?.amountPaid ?? -1), 0, "amountPaid=0");
  } finally {
    await cleanup(prisma, [year, year + 1], hhId);
  }
});

// B：手動新增乙位正魂（sync）→ 永久名單 INDIVIDUAL 出現。
dbTest("B 新增乙位正魂同步永久名單：WorshipRecord(INDIVIDUAL) 出現、帶姓名/地址/陽上人", async () => {
  const { prisma, templeEvents, ritual } = await load();
  const year = 9632;
  const hhId = hhIdFor(year);
  try {
    await setup(prisma, templeEvents, year, hhId);
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    await ritual.createUniversalSalvationEntry(
      hhId, year,
      { category: "INDIVIDUAL_SOUL", displayName: "王小明 乙位正魂", yangshangNames: ["王大"], tabletAddress: "正魂路2號", syncToHousehold: true },
      "測試"
    );
    const wr = await worshipOf(prisma, hhId, "INDIVIDUAL");
    assert.equal(wr.length, 1);
    assert.equal(wr[0].displayName, "王小明 乙位正魂");
    assert.equal(wr[0].location, "正魂路2號");
    assert.equal(wr[0].yangshangName, "王大");
  } finally {
    await cleanup(prisma, [year, year + 1], hhId);
  }
});

// C：取消同步（syncToHousehold=false）→ 只建活動草稿、不寫永久名單。
dbTest("C 取消同步：syncToHousehold=false → 不建立 WorshipRecord", async () => {
  const { prisma, templeEvents, ritual } = await load();
  const year = 9633;
  const hhId = hhIdFor(year);
  try {
    await setup(prisma, templeEvents, year, hhId);
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    await ritual.createUniversalSalvationEntry(
      hhId, year,
      { category: "ANCESTOR_LINE", displayName: "林姓歷代祖先", tabletAddress: "林路1號", syncToHousehold: false },
      "測試"
    );
    assert.equal((await worshipOf(prisma, hhId, "ANCESTOR_LINE")).length, 0, "不勾同步不得寫永久名單");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "本次活動草稿仍建立");
  } finally {
    await cleanup(prisma, [year, year + 1], hhId);
  }
});

// D：編輯已連結牌位（sync）→ 更新同一筆 WorshipRecord，不重複新增。
dbTest("D 編輯同步：更新原 WorshipRecord（同一筆、不新增），值一致", async () => {
  const { prisma, templeEvents, ritual } = await load();
  const year = 9634;
  const hhId = hhIdFor(year);
  try {
    await setup(prisma, templeEvents, year, hhId);
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    await ritual.createUniversalSalvationEntry(
      hhId, year,
      { category: "ANCESTOR_LINE", displayName: "李姓歷代祖先", tabletAddress: "李路1號", syncToHousehold: true },
      "測試"
    );
    const before = await worshipOf(prisma, hhId, "ANCESTOR_LINE");
    assert.equal(before.length, 1);
    const e = await entriesOf(prisma, year, "ANCESTOR_LINE");

    const upd = await ritual.updateUniversalSalvationEntry(
      hhId, year, e[0].id,
      { tabletAddress: "李路改9號", yangshangNames: ["李孝男"], syncToHousehold: true },
      "測試"
    );
    assert.equal(upd.ok, true, upd.ok ? "" : `更新失敗：${upd.error}`);

    const after = await worshipOf(prisma, hhId, "ANCESTOR_LINE");
    assert.equal(after.length, 1, "編輯同步不得新增第二筆永久名單");
    assert.equal(after[0].id, before[0].id, "更新的是同一筆");
    assert.equal(after[0].location, "李路改9號", "地址已同步");
    assert.equal(after[0].yangshangName, "李孝男", "陽上人已同步");
  } finally {
    await cleanup(prisma, [year, year + 1], hhId);
  }
});

// E：同名不同地址 → 兩筆不同 WorshipRecord（不合併）。
dbTest("E 同名不同址不合併：永久名單建立 2 筆不同牌位", async () => {
  const { prisma, templeEvents, ritual } = await load();
  const year = 9635;
  const hhId = hhIdFor(year);
  try {
    await setup(prisma, templeEvents, year, hhId);
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    await ritual.createUniversalSalvationEntry(hhId, year, { category: "INDIVIDUAL_SOUL", displayName: "陳大明 乙位正魂", tabletAddress: "台北市中山路1號", syncToHousehold: true }, "測試");
    await ritual.createUniversalSalvationEntry(hhId, year, { category: "INDIVIDUAL_SOUL", displayName: "陳大明 乙位正魂", tabletAddress: "新北市板橋區2號", syncToHousehold: true }, "測試");
    const wr = await worshipOf(prisma, hhId, "INDIVIDUAL");
    assert.equal(wr.length, 2, "同名不同址視為 2 張牌位");
    assert.deepEqual([...new Set(wr.map((w) => w.location))].sort(), ["台北市中山路1號", "新北市板橋區2號"]);
  } finally {
    await cleanup(prisma, [year, year + 1], hhId);
  }
});

// F+G：刪除活動草稿不刪永久名單；明年重新進入活動可自動帶入（且不重複永久名單）。
dbTest("F+G 刪除不影響永久名單；明年 batch 自動帶入、永久名單不重複", async () => {
  const { prisma, templeEvents, ritual, reg } = await load();
  const year = 9636;
  const nextYear = year + 1;
  const hhId = hhIdFor(year);
  try {
    const { m } = await setup(prisma, templeEvents, year, hhId);
    await createEvent(templeEvents, nextYear); // 明年活動
    await ritual.createBlankUniversalSalvationRecord(hhId, year);
    await ritual.createUniversalSalvationEntry(
      hhId, year,
      { category: "ANCESTOR_LINE", displayName: "吳姓歷代祖先", yangshangNames: ["吳大"], tabletAddress: "吳路1號", syncToHousehold: true },
      "測試"
    );
    const wrBefore = await worshipOf(prisma, hhId, "ANCESTOR_LINE");
    assert.equal(wrBefore.length, 1);

    // F：刪除本次活動草稿 entry → 永久名單仍在。
    const e = await entriesOf(prisma, year, "ANCESTOR_LINE");
    const del = await ritual.deleteUniversalSalvationEntry(hhId, year, e[0].id, "測試");
    assert.equal(del.ok, true);
    assert.equal((await worshipOf(prisma, hhId, "ANCESTOR_LINE")).length, 1, "刪除活動草稿不得刪永久名單");

    // G：明年 batch 報名祖先 → 由永久名單自動帶入成草稿；連結同一 WorshipRecord。
    const anc = await usItemId(prisma, "US_ANCESTOR");
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: anc, year: nextYear }], "測試");
    const eNext = await entriesOf(prisma, nextYear, "ANCESTOR_LINE");
    assert.equal(eNext.length, 1, "明年自動帶入 1 筆祖先");
    assert.equal(eNext[0].displayName, "吳姓歷代祖先", "帶入永久名單姓名");
    assert.equal(eNext[0].tabletAddress, "吳路1號", "帶入永久名單地址");
    assert.equal((eNext[0] as { worshipRecordId: string | null }).worshipRecordId, wrBefore[0].id, "連結同一永久名單");

    // 永久名單未因帶入而重複。
    assert.equal((await worshipOf(prisma, hhId, "ANCESTOR_LINE")).length, 1, "永久名單不重複");
  } finally {
    await cleanup(prisma, [year, nextYear], hhId);
  }
});
