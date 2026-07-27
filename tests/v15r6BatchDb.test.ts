import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R6 普渡報名流程整合——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r6BatchDb.test.ts
 *
 * 驗證正式需求：
 *   - 歷代祖先／乙位正魂：一次勾選 → 本戶「每一筆既有牌位各建一筆草稿」（fan-out，不只帶第一筆）。
 *   - 每筆各自帶入 name / tabletAddress / yangshangNames，且各自 1:1 linked item、各一份應收。
 *   - 同名但不同地址＝不同牌位，不得合併。
 *   - 返回重進（重送 batch）不重複建立（per-tablet 冪等）。
 *   - 家戶多人 × 多項目：一次送出整戶所有選擇，走既有 registerItemsBatch。
 *   - amountPaid 一律 0（建立草稿不入已收）。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  return { prisma, templeEvents, reg };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const TABLET_UNIT = 2500;
const SPONSOR_UNIT = 800; // 本年度贊普固定單價（沿用正式價格模型，D 案含贊普項目）
const SUITE = "T6"; // Household.id VarChar(10)：T6+4 位年度=6 字元
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function usItemKeys(prisma: P) {
  const rows = await prisma.registrationItemType.findMany({
    where: { key: { in: ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_SPONSOR"] } },
    select: { id: true, key: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
}

async function setup(prisma: P, templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"], year: number, hhId: string) {
  await cleanup(prisma, year, hhId);
  const ev = await templeEvents.createTempleEvent({ activityType: "UNIVERSAL_SALVATION", year }, "測試");
  assert.equal(ev.ok, true, ev.ok ? "" : `建立普渡活動失敗：${ev.error}`);
  if (ev.ok) {
    await templeEvents.updateTempleEventTabletPrices(
      ev.data.id,
      { ancestorUnitPrice: TABLET_UNIT, zhenghunUnitPrice: TABLET_UNIT, yuanqinUnitPrice: TABLET_UNIT, wuyuanUnitPrice: TABLET_UNIT },
      "測試"
    );
    // 本年度贊普固定單價（D 案含 US_SPONSOR）——沿用正式價格模型，不繞過價格檢查、不加 fallback。
    await templeEvents.updateTempleEventSponsorUnitPrice(ev.data.id, SPONSOR_UNIT, "測試");
  }
  const hh = await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
  const m1 = await prisma.member.create({ data: { householdId: hh.id, name: "邱明宏", isPrimaryContact: true } });
  const m2 = await prisma.member.create({ data: { householdId: hh.id, name: "林來于" } });
  return { hh, m1, m2 };
}

async function seedWorship(prisma: P, hhId: string, type: "ANCESTOR_LINE" | "INDIVIDUAL", displayName: string, yangshang: string, location: string) {
  await prisma.worshipRecord.create({ data: { householdId: hhId, type, displayName, yangshangName: yangshang, location } });
}

async function entriesOf(prisma: P, year: number, category: string) {
  return prisma.universalSalvationEntry.findMany({
    where: { deletedAt: null, category: category as never, universalSalvation: { ritualRecord: { year } } },
    include: { registrationItem: { select: { id: true, amountDue: true, amountPaid: true } } },
    orderBy: { createdAt: "asc" },
  });
}

async function cleanup(prisma: P, year: number, hhId: string) {
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year } } });
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { year } } } });
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { year } } });
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { year } } });
  await prisma.ritualRecord.deleteMany({ where: { year } });
  await prisma.worshipRecord.deleteMany({ where: { householdId: hhId } });
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  await prisma.household.deleteMany({ where: { id: hhId } });
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } });
  await prisma.templeEvent.deleteMany({ where: { year } });
}

// ── A：多筆既有祖先 → 各建一筆草稿（fan-out），每筆帶自己的資料，重送不增，amountPaid=0 ──
dbTest("A 多祖先 fan-out：2 既有祖先 → 2 草稿各帶自己資料；重送不增；amountPaid=0", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9621;
  const hhId = hhIdFor(year);
  try {
    const { m1 } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hhId, "ANCESTOR_LINE", "邱姓歷代祖先", "邱大", "祖先路1號");
    await seedWorship(prisma, hhId, "ANCESTOR_LINE", "陳姓歷代祖先", "陳二", "祖先路2號");
    const keys = await usItemKeys(prisma);

    await reg.registerItemsBatch([{ memberId: m1.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    const e1 = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(e1.length, 2, `2 既有祖先應各建 1 筆草稿，實得 ${e1.length}`);
    const names = new Set(e1.map((e) => e.displayName));
    assert.deepEqual([...names].sort(), ["邱姓歷代祖先", "陳姓歷代祖先"]);
    const first = e1.find((e) => e.displayName === "邱姓歷代祖先")!;
    assert.equal(first.tabletAddress, "祖先路1號", "各自帶入自己的地址");
    assert.deepEqual(first.yangshangNames, ["邱大"], "各自帶入自己的陽上人");
    assert.ok(e1.every((e) => e.registrationItem && Number(e.registrationItem.amountDue) === TABLET_UNIT), "各自 1 份應收 2500");
    assert.ok(e1.every((e) => e.registrationItem && Number(e.registrationItem.amountPaid) === 0), "amountPaid 一律 0");

    // 返回重進：重送 batch → 不重複建立。
    await reg.registerItemsBatch([{ memberId: m1.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    const e2 = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(e2.length, 2, "重送不增（per-tablet 冪等）");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── B：多位既有乙位正魂 → 各建一筆草稿 ──
dbTest("B 多正魂 fan-out：2 既有正魂 → 2 草稿各帶自己姓名/地址/陽上人", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9622;
  const hhId = hhIdFor(year);
  try {
    const { m1 } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hhId, "INDIVIDUAL", "王甲乙位正魂", "王陽", "正魂路1號");
    await seedWorship(prisma, hhId, "INDIVIDUAL", "王乙乙位正魂", "王陽", "正魂路2號");
    const keys = await usItemKeys(prisma);

    await reg.registerItemsBatch([{ memberId: m1.id, registrationItemTypeId: keys["US_ZHENGHUN"], year }], "測試");
    const e = await entriesOf(prisma, year, "INDIVIDUAL_SOUL");
    assert.equal(e.length, 2, `2 既有正魂應各建 1 筆草稿，實得 ${e.length}`);
    assert.deepEqual([...new Set(e.map((x) => x.displayName))].sort(), ["王乙乙位正魂", "王甲乙位正魂"]);
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── C：同名不同地址 → 兩張不同牌位，不得合併 ──
dbTest("C 同名不同址不合併：同名祖先兩不同地址 → 2 筆各自草稿", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9623;
  const hhId = hhIdFor(year);
  try {
    const { m1 } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hhId, "ANCESTOR_LINE", "林姓歷代祖先", "林大", "台北市中山路1號");
    await seedWorship(prisma, hhId, "ANCESTOR_LINE", "林姓歷代祖先", "林大", "新北市板橋區2號");
    const keys = await usItemKeys(prisma);

    await reg.registerItemsBatch([{ memberId: m1.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    const e = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(e.length, 2, `同名不同址視為 2 張牌位，不得合併為 1，實得 ${e.length}`);
    assert.deepEqual([...new Set(e.map((x) => x.tabletAddress))].sort(), ["台北市中山路1號", "新北市板橋區2號"]);
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── D：家戶多人 × 多項目一次送出（picker 走的路徑）──
dbTest("D 多人多項目：兩位成員各報名 → 一次 batch 建立整戶草稿，amountPaid=0", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9624;
  const hhId = hhIdFor(year);
  try {
    const { m1, m2 } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hhId, "ANCESTOR_LINE", "邱姓歷代祖先", "邱大", "祖先路1號");
    const keys = await usItemKeys(prisma);

    const batch = await reg.registerItemsBatch(
      [
        { memberId: m1.id, registrationItemTypeId: keys["US_ANCESTOR"], year },
        { memberId: m1.id, registrationItemTypeId: keys["US_YUANQIN"], year },
        { memberId: m2.id, registrationItemTypeId: keys["US_YUANQIN"], year },
        { memberId: m2.id, registrationItemTypeId: keys["US_SPONSOR"], year, customName: "林來于" },
      ],
      "測試"
    );
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${(batch as { error?: string }).error}`);

    const yuanqin = await entriesOf(prisma, year, "DEBT_CREDITOR");
    assert.equal(yuanqin.length, 2, "兩位成員各一筆冤親");
    const ancestor = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(ancestor.length, 1, "m1 的祖先一筆（本戶一張既有祖先）");
    const allItems = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecord: { year }, deletedAt: null }, select: { amountPaid: true } });
    assert.ok(allItems.every((i) => Number(i.amountPaid) === 0), "整戶建立草稿 amountPaid 一律 0");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
