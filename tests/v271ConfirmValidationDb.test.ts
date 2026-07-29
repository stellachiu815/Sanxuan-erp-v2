import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.1 確認驗證 regression（待 Mac）：
 *   A. 軟刪除 entry 不出現在 getUniversalSalvationRecord。
 *   B. 空白牌位佔位（名稱空）不產生「缺陽上人」。
 *   C. 已建立、缺陽上人的祖先 entry → 仍正確阻擋。
 *   D. 補上陽上人後 → 驗證通過。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v271ConfirmValidationDb.test.ts
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

const HH_ID = "T271E";
const YEAR = 195;

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

dbTest("軟刪除不顯示、祖先缺陽上人擋、補齊後通過", async () => {
  const l = await load();
  try {
    await cleanup(l);
    await l.prisma.household.create({ data: { id: HH_ID, name: "V271E測試家戶" } });
    const blank = await l.ritual.createBlankUniversalSalvationRecord(HH_ID, YEAR);
    assert.equal(blank.ok, true);
    const rec = (await l.prisma.ritualRecord.findFirst({ where: { householdId: HH_ID, year: YEAR, activityType: "UNIVERSAL_SALVATION" } }))!;

    // C：已建立、缺陽上人的祖先 → 阻擋。
    const named = await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "ANCESTOR_LINE", displayName: "測試祖先", yangshangNames: [], tabletAddress: "台北市A路", syncToHousehold: false }, "測試");
    assert.equal(named.ok, true);
    let r = await l.gate.checkRitualRecordCompleteness(rec.id);
    assert.equal(r.complete, false, "C：已建立祖先缺陽上人 → 阻擋");
    assert.ok(r.missing.some((m) => m.field === "yangshang"), "缺項含 yangshang");

    // D：補上陽上人 → 通過。
    const namedEntry = named.ok ? named.record.universalSalvation!.entries.find((e) => e.displayName === "測試祖先")! : null;
    await l.ritual.updateUniversalSalvationEntry(HH_ID, YEAR, namedEntry!.id, { yangshangNames: ["甲"] }, "測試");
    r = await l.gate.checkRitualRecordCompleteness(rec.id);
    assert.equal(r.complete, true, "D：補上陽上人後通過");

    // A：軟刪除該祖先 entry → getUniversalSalvationRecord 不含它。
    await l.prisma.universalSalvationEntry.update({ where: { id: namedEntry!.id }, data: { deletedAt: new Date() } });
    const rec2 = await l.ritual.getUniversalSalvationRecord(HH_ID, YEAR);
    const names = rec2!.universalSalvation!.entries.map((e) => e.displayName);
    assert.ok(!names.includes("測試祖先"), "A：軟刪除 entry 不出現在 record");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
