import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";

/**
 * V15R7 普渡 Excel 匯入——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r7ImportDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const imp = await import("../src/lib/purificationImport");
  return { prisma, templeEvents, imp };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const TABLET_UNIT = 2500;
const SPONSOR_UNIT = 800;
const SUITE = "F76"; // Household.id VarChar(10)

function xlsxBuffer(aoa: (string | number)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "s");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function setup(prisma: P, templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"], year: number, hhId: string) {
  await cleanup(prisma, year, hhId);
  const ev = await templeEvents.createTempleEvent({ activityType: "UNIVERSAL_SALVATION", year }, "測試");
  assert.equal(ev.ok, true, ev.ok ? "" : `建立普渡活動失敗：${ev.error}`);
  let eventId: string | null = null;
  if (ev.ok) {
    eventId = ev.data.id;
    await templeEvents.updateTempleEventTabletPrices(ev.data.id, { ancestorUnitPrice: TABLET_UNIT, zhenghunUnitPrice: TABLET_UNIT, yuanqinUnitPrice: TABLET_UNIT, wuyuanUnitPrice: TABLET_UNIT }, "測試");
    await templeEvents.updateTempleEventSponsorUnitPrice(ev.data.id, SPONSOR_UNIT, "測試");
  }
  const hh = await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
  return { hh, eventId };
}

async function cleanup(prisma: P, year: number, hhId: string) {
  const batches = await prisma.purificationImportBatch.findMany({ where: { year }, select: { id: true } });
  const ids = batches.map((b) => b.id);
  if (ids.length) await prisma.purificationImportRow.deleteMany({ where: { batchId: { in: ids } } });
  await prisma.purificationImportBatch.deleteMany({ where: { year } });
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

/**
 * 逐列標成「已配對此家戶、已解決、操作人確認建列」（模擬人工逐列確認），讓 confirm 可物化。
 * createNewDevoteeConfirmed=true 只讓 isRowConfirmable 通過；因祖先列 devoteeName 為 null，
 * confirm 不會建立多餘信眾（見 purificationImport confirm：需 devoteeName 才建信眾）。
 */
async function markRowsMatched(prisma: P, batchId: string, hhId: string) {
  await prisma.purificationImportRow.updateMany({ where: { batchId }, data: { matchedHouseholdId: hhId, resolved: true, createNewDevoteeConfirmed: true } });
}

/** 確認並斷言逐列成功；任一列失敗即把真正錯誤訊息拋出（避免只看到「建立 0 筆」）。 */
async function confirmOk(imp: Awaited<ReturnType<typeof load>>["imp"], batchId: string, key: string) {
  const c = await imp.confirmPurificationImportBatch({ batchId, confirmationKey: key, actor: { role: "ADMIN", userId: "u1", name: "測試" } });
  assert.equal(c.ok, true, c.ok ? "" : `confirm 失敗：${(c as { error?: string }).error}`);
  if (c.ok) {
    const failed = c.results.filter((r) => !r.ok);
    assert.equal(failed.length, 0, `有列物化失敗：${failed.map((r) => `#${r.rowNumber} ${r.error}`).join("；")}`);
  }
  return c;
}

async function ancestorEntries(prisma: P, year: number) {
  return prisma.universalSalvationEntry.findMany({
    where: { deletedAt: null, category: "ANCESTOR_LINE", universalSalvation: { ritualRecord: { year } } },
    include: { registrationItem: { select: { amountPaid: true } } },
    orderBy: { createdAt: "asc" },
  });
}

// A：祖先匯入 → 草稿＋同步永久名單；重複上傳標「已存在」預設略過、不重複。
dbTest("A 祖先匯入：建草稿＋同步 WorshipRecord＋amountPaid=0；重上傳略過不重複", async () => {
  const { prisma, templeEvents, imp } = await load();
  const year = 7601;
  const hhId = `${SUITE}01`;
  try {
    await setup(prisma, templeEvents, year, hhId);
    const buf = xlsxBuffer([
      ["家戶編號", "牌位姓名", "牌位地址", "陽上人"],
      [hhId, "陳姓歷代祖先", "陳路1號", "陳大"],
    ]);
    const a1 = await imp.analyzePurificationImport({ buffer: buf, year, templeEventId: null, createdByUserId: "u1", forcedCategory: "ANCESTOR_LINE" });
    assert.equal(a1.ok, true, a1.ok ? "" : `analyze 失敗：${a1.error}`);
    if (!a1.ok) return;
    await markRowsMatched(prisma, a1.batchId, hhId);
    await confirmOk(imp, a1.batchId, "k1");

    const e1 = await ancestorEntries(prisma, year);
    assert.equal(e1.length, 1, "建立 1 筆祖先牌位");
    assert.equal(e1[0].displayName, "陳姓歷代祖先");
    assert.equal(e1[0].tabletAddress, "陳路1號");
    assert.equal(Number(e1[0].registrationItem?.amountPaid ?? -1), 0, "amountPaid=0");
    const rec = await prisma.ritualRecord.findFirst({ where: { householdId: hhId, year, activityType: "UNIVERSAL_SALVATION" }, select: { status: true } });
    assert.equal(rec?.status, "DRAFT", "匯入建草稿");

    const wr = await prisma.worshipRecord.findMany({ where: { householdId: hhId, type: "ANCESTOR_LINE" } });
    assert.equal(wr.length, 1, "同步 1 筆永久名單");
    assert.equal(wr[0].location, "陳路1號");
    assert.equal(wr[0].yangshangName, "陳大");

    // 重複上傳 → 第二批標 EXISTS、預設 SKIP；confirm 不重複建立。
    const a2 = await imp.analyzePurificationImport({ buffer: buf, year, templeEventId: null, createdByUserId: "u1", forcedCategory: "ANCESTOR_LINE" });
    assert.equal(a2.ok, true);
    if (!a2.ok) return;
    const r2 = await prisma.purificationImportRow.findFirst({ where: { batchId: a2.batchId } });
    assert.equal((r2 as unknown as { existingMatchStatus: string }).existingMatchStatus, "EXISTS", "標記已存在");
    assert.equal((r2 as unknown as { resolutionAction: string }).resolutionAction, "SKIP", "預設略過");
    await markRowsMatched(prisma, a2.batchId, hhId);
    await confirmOk(imp, a2.batchId, "k2");
    assert.equal((await ancestorEntries(prisma, year)).length, 1, "重上傳不重複建立");
    assert.equal((await prisma.worshipRecord.count({ where: { householdId: hhId, type: "ANCESTOR_LINE" } })), 1, "永久名單不重複");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// B：取消同步（syncToHousehold=false）→ 只建活動草稿、不寫永久名單。
dbTest("B 取消同步：syncToHousehold=false → 不建 WorshipRecord", async () => {
  const { prisma, templeEvents, imp } = await load();
  const year = 7602;
  const hhId = `${SUITE}02`;
  try {
    await setup(prisma, templeEvents, year, hhId);
    const buf = xlsxBuffer([["家戶編號", "牌位姓名", "牌位地址"], [hhId, "林姓歷代祖先", "林路1號"]]);
    const a = await imp.analyzePurificationImport({ buffer: buf, year, templeEventId: null, createdByUserId: "u1", forcedCategory: "ANCESTOR_LINE" });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    await markRowsMatched(prisma, a.batchId, hhId);
    await prisma.purificationImportRow.updateMany({ where: { batchId: a.batchId }, data: ({ syncToHousehold: false } as unknown as object) });
    await confirmOk(imp, a.batchId, "k1");
    assert.equal((await ancestorEntries(prisma, year)).length, 1, "仍建立活動草稿");
    assert.equal((await prisma.worshipRecord.count({ where: { householdId: hhId, type: "ANCESTOR_LINE" } })), 0, "不勾同步不得寫永久名單");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// C：同名不同地址 → 兩筆不同牌位（不合併）。
dbTest("C 同名不同址不合併：2 筆不同祖先牌位", async () => {
  const { prisma, templeEvents, imp } = await load();
  const year = 7603;
  const hhId = `${SUITE}03`;
  try {
    await setup(prisma, templeEvents, year, hhId);
    const buf = xlsxBuffer([
      ["家戶編號", "牌位姓名", "牌位地址"],
      [hhId, "黃姓歷代祖先", "台北市中山路1號"],
      [hhId, "黃姓歷代祖先", "新北市板橋區2號"],
    ]);
    const a = await imp.analyzePurificationImport({ buffer: buf, year, templeEventId: null, createdByUserId: "u1", forcedCategory: "ANCESTOR_LINE" });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    await markRowsMatched(prisma, a.batchId, hhId);
    await confirmOk(imp, a.batchId, "k1");
    const e = await ancestorEntries(prisma, year);
    // DB 查詢不保證順序 → 用「集合」與「包含」斷言，不比固定陣列順序。
    const addrs = e.map((x) => x.tabletAddress);
    assert.equal(e.length, 2, "同名不同址＝2 筆");
    assert.equal(new Set(addrs).size, 2, "兩地址不相同（同名不同址未被合併）");
    assert.ok(addrs.includes("台北市中山路1號"), "含台北地址");
    assert.ok(addrs.includes("新北市板橋區2號"), "含新北地址");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// D：隨喜贊普 → 讀 Excel 金額、狀態 DRAFT、amountPaid=0。
dbTest("D 隨喜贊普：讀 Excel 金額、item 為 DRAFT、amountPaid=0", async () => {
  const { prisma, templeEvents, imp } = await load();
  const year = 7604;
  const hhId = `${SUITE}04`;
  try {
    const { eventId } = await setup(prisma, templeEvents, year, hhId);
    const buf = xlsxBuffer([["家戶編號", "牌位姓名", "隨喜金額"], [hhId, "吳姓歷代祖先", 3000]]);
    const a = await imp.analyzePurificationImport({ buffer: buf, year, templeEventId: eventId, createdByUserId: "u1", forcedCategory: "ANCESTOR_LINE" });
    assert.equal(a.ok, true);
    if (!a.ok) return;
    await markRowsMatched(prisma, a.batchId, hhId);
    await confirmOk(imp, a.batchId, "k1");
    const donation = await prisma.ritualRegistrationItem.findFirst({ where: { registrationItemType: { key: "US_SPONSOR_DONATION" }, ritualRecord: { year } } });
    assert.ok(donation, "建立隨喜贊普 item");
    assert.equal(donation!.status, "DRAFT", "狀態為草稿");
    assert.equal(Number(donation!.amountDue), 3000, "金額讀 Excel 隨喜金額");
    assert.equal(Number(donation!.amountPaid), 0, "amountPaid=0");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
