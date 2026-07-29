import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.1：家戶永久名單 → 本年度草稿「陽上人補入」DB 整合測試（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v271BackfillYangshangDb.test.ts
 *
 * 驗收：
 *   - 年度草稿祖先缺陽上人、永久名單有值 → 自動補入。
 *   - 永久名單沒有陽上人 → 不補、維持缺少（不猜測）。
 *   - 年度草稿已有陽上人 → 不覆蓋。
 *   - 乙位正魂同樣適用。冪等：重跑 filled=0。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const sync = await import("../src/lib/householdWorshipSync");
  return { prisma, ritual, sync };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH_ID = "T271B";
const YEAR = 198;

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

dbTest("永久名單有陽上人 → 補入本年度缺陽上人的祖先草稿；無值不補；已有不覆蓋；正魂同理；冪等", async () => {
  const l = await load();
  try {
    await cleanup(l);
    await l.prisma.household.create({ data: { id: HH_ID, name: "V271B測試家戶" } });
    const blank = await l.ritual.createBlankUniversalSalvationRecord(HH_ID, YEAR);
    assert.equal(blank.ok, true);

    // 草稿：三筆缺陽上人（syncToHousehold=false，不建永久名單）。
    const mk = (category: "ANCESTOR_LINE" | "INDIVIDUAL_SOUL", displayName: string, addr: string) =>
      l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category, displayName, yangshangNames: [], tabletAddress: addr, syncToHousehold: false }, "測試");
    await mk("ANCESTOR_LINE", "周姓歷代祖先", "台北市A路1號"); // 永久有值 → 應補
    await mk("ANCESTOR_LINE", "陳姓歷代祖先", "台北市B路2號"); // 永久無值 → 不補
    const soul = await mk("INDIVIDUAL_SOUL", "王小明 乙位正魂", "台北市A路1號"); // 正魂永久有值 → 應補
    assert.equal(soul.ok, true);

    // 已有陽上人的草稿（不可被覆蓋）。
    await l.ritual.createUniversalSalvationEntry(HH_ID, YEAR, { category: "ANCESTOR_LINE", displayName: "李姓歷代祖先", yangshangNames: ["原有人"], tabletAddress: "台北市C路3號", syncToHousehold: false }, "測試");

    // 永久名單：周姓(有值)、王小明正魂(有值)；陳姓永久無陽上人。
    await l.prisma.worshipRecord.create({ data: { householdId: HH_ID, type: "ANCESTOR_LINE", displayName: "周姓歷代祖先", location: "台北市A路1號", yangshangName: "周財寶" } });
    await l.prisma.worshipRecord.create({ data: { householdId: HH_ID, type: "ANCESTOR_LINE", displayName: "陳姓歷代祖先", location: "台北市B路2號", yangshangName: null } });
    await l.prisma.worshipRecord.create({ data: { householdId: HH_ID, type: "INDIVIDUAL", displayName: "王小明 乙位正魂", location: "台北市A路1號", yangshangName: "王大明" } });

    const r1 = await l.sync.backfillYearAncestorYangshangFromHousehold(HH_ID, YEAR, "測試");
    assert.equal(r1.filled, 2, "應補入 2 筆（周姓祖先＋王小明正魂）");

    const entries = (await l.ritual.getUniversalSalvationRecord(HH_ID, YEAR))!.universalSalvation!.entries;
    const byName = (n: string) => entries.find((e) => e.displayName === n)!;
    assert.deepEqual(byName("周姓歷代祖先").yangshangNames, ["周財寶"], "周姓補入");
    assert.deepEqual(byName("王小明 乙位正魂").yangshangNames, ["王大明"], "正魂補入");
    assert.deepEqual(byName("陳姓歷代祖先").yangshangNames, [], "永久無值 → 不補（維持缺少）");
    assert.deepEqual(byName("李姓歷代祖先").yangshangNames, ["原有人"], "已有值 → 不覆蓋");

    const r2 = await l.sync.backfillYearAncestorYangshangFromHousehold(HH_ID, YEAR, "測試");
    assert.equal(r2.filled, 0, "冪等：再跑不重複補");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
