import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.1 D：周家型態資料——1 筆祖先（有陽上人）＋2 筆累世冤親債主（無陽上人）→
 * 確認預檢（checkRitualRecordCompleteness）通過。待 Mac：
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v271YuanqinConfirmDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const gate = await import("../src/lib/completenessGate");
  return { prisma, ritual, gate };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH_ID = "T271F";
const YEAR = 194;

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rec = await prisma.ritualRecord.findFirst({
    where: { householdId: HH_ID, year: YEAR, activityType: "UNIVERSAL_SALVATION" },
    include: { universalSalvation: { include: { entries: true } } },
  });
  if (rec) {
    const ids = rec.universalSalvation?.entries.map((e) => e.id) ?? [];
    await prisma.additionalPrintItem.deleteMany({ where: { ritualRecordId: rec.id } }).catch(() => {});
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rec.id } }).catch(() => {});
    if (ids.length) await prisma.universalSalvationEntry.deleteMany({ where: { id: { in: ids } } }).catch(() => {});
    await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecordId: rec.id } }).catch(() => {});
    await prisma.ritualRecord.delete({ where: { id: rec.id } }).catch(() => {});
  }
  await prisma.worshipRecord.deleteMany({ where: { householdId: HH_ID } }).catch(() => {});
  await prisma.household.deleteMany({ where: { id: HH_ID } }).catch(() => {});
}

dbTest("D：祖先(有陽上人)＋兩筆冤親債主(無陽上人) → 確認預檢通過", async () => {
  const l = await load();
  try {
    await cleanup(l);
    await l.prisma.household.create({ data: { id: HH_ID, name: "V271F測試家戶" } });
    const blank = await l.ritual.createBlankUniversalSalvationRecord(HH_ID, YEAR);
    assert.equal(blank.ok, true);
    const rec = (await l.prisma.ritualRecord.findFirst({ where: { householdId: HH_ID, year: YEAR, activityType: "UNIVERSAL_SALVATION" } }))!;

    await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "ANCESTOR_LINE", displayName: "周姓歷代祖先", yangshangNames: ["周財寶"], tabletAddress: "台北市A路", syncToHousehold: false }, "測試");
    await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "DEBT_CREDITOR", displayName: "周財寶", yangshangNames: [], tabletAddress: null, syncToHousehold: false }, "測試");
    await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "DEBT_CREDITOR", displayName: "陳秀珍", yangshangNames: [], tabletAddress: null, syncToHousehold: false }, "測試");

    const r = await l.gate.checkRitualRecordCompleteness(rec.id);
    assert.equal(r.complete, true, `D：三筆應通過（missing=${JSON.stringify(r.missing)}）`);
  } finally {
    await cleanup(l).catch(() => {});
  }
});
