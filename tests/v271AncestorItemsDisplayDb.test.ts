import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.1 regression：同一 ritualRecord 有兩筆 ANCESTOR_LINE 時，listRegisteredItems
 * （已報名項目資料來源）**兩筆都要回**，不得以 category 當唯一鍵覆蓋前一筆；
 * 軟刪除其中一筆後，另一筆仍必須存在。待 Mac：
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v271AncestorItemsDisplayDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const reg = await import("../src/lib/registrationItemRegistration");
  return { prisma, ritual, reg };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH_ID = "T271D";
const YEAR = 196;

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

dbTest("兩筆 ANCESTOR_LINE 都出現在 listRegisteredItems；軟刪除一筆後另一筆仍在", async () => {
  const l = await load();
  try {
    await cleanup(l);
    await l.prisma.household.create({ data: { id: HH_ID, name: "V271D測試家戶" } });
    const blank = await l.ritual.createBlankUniversalSalvationRecord(HH_ID, YEAR);
    assert.equal(blank.ok, true);

    const zhou = await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "ANCESTOR_LINE", displayName: "周姓歷代祖先", yangshangNames: ["周財寶"], tabletAddress: "台北市A路", syncToHousehold: false }, "測試");
    const lin = await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "ANCESTOR_LINE", displayName: "林姓歷代祖先", yangshangNames: ["周財寶"], tabletAddress: "台北市B路", syncToHousehold: false }, "測試");
    assert.equal(zhou.ok && lin.ok, true);

    const rec = (await l.prisma.ritualRecord.findFirst({ where: { householdId: HH_ID, year: YEAR, activityType: "UNIVERSAL_SALVATION" } }))!;

    // 兩筆都要回。
    let items = await l.reg.listRegisteredItems(rec.id);
    const ancestors = items.filter((i) => i.itemKey === "US_ANCESTOR");
    const names = ancestors.map((i) => i.subjectName).sort();
    assert.deepEqual(names, ["周姓歷代祖先", "林姓歷代祖先"].sort(), "兩筆 US_ANCESTOR 都要顯示（不被 category 覆蓋）");

    // 軟刪除林姓（item + entry）→ 周姓仍在。
    const linEntry = lin.ok ? lin.record.universalSalvation!.entries.find((e) => e.displayName === "林姓歷代祖先")! : null;
    const linItem = await l.prisma.ritualRegistrationItem.findUnique({ where: { universalSalvationEntryId: linEntry!.id } });
    await l.prisma.ritualRegistrationItem.update({ where: { id: linItem!.id }, data: { deletedAt: new Date(), status: "CANCELLED" } });
    await l.prisma.universalSalvationEntry.update({ where: { id: linEntry!.id }, data: { deletedAt: new Date() } });

    items = await l.reg.listRegisteredItems(rec.id);
    const ancestors2 = items.filter((i) => i.itemKey === "US_ANCESTOR");
    assert.equal(ancestors2.length, 1, "軟刪除林姓後只剩一筆");
    assert.equal(ancestors2[0].subjectName, "周姓歷代祖先", "周姓仍必須顯示");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
