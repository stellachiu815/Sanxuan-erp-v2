import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R4 正式站回歸——DB 級整合測試。
 *
 * 需真實測試資料庫，預設**跳過**（未設 RUN_DB_TESTS）。執行：
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫，切勿正式庫>" npx tsx --test tests/v15r4RegressionDb.test.ts
 *
 * 這是 DB integration test（非 source-scan）——實際建立資料、檢查 DB 前後。
 * 涵蓋：年度燈統一為單一 TempleEvent、四項共用單一 RitualRecord、祭改於年度燈事件下
 * 建立 PurificationEntry（小人頭列印中心可見）、全戶多人多項目一次送出、ALREADY_EXISTS。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  const purification = await import("../src/lib/purification");
  return { prisma, templeEvents, reg, purification };
}

async function cleanupYear(prisma: Awaited<ReturnType<typeof load>>["prisma"], year: number, hhId?: string) {
  await prisma.purificationEntry.deleteMany({ where: { templeEvent: { year } } }).catch(() => {});
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year } } }).catch(() => {});
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { year } } }).catch(() => {});
  await prisma.lanternRegistration.deleteMany({ where: { ritualRecord: { year } } }).catch(() => {});
  await prisma.ritualRecord.deleteMany({ where: { year } }).catch(() => {});
  if (hhId) {
    await prisma.member.deleteMany({ where: { householdId: hhId } }).catch(() => {});
    await prisma.household.deleteMany({ where: { id: hhId } }).catch(() => {});
  }
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } }).catch(() => {});
  await prisma.templeEvent.deleteMany({ where: { year } }).catch(() => {});
}

// ── 四、年度燈統一：單一 TempleEvent ─────────────────────────

dbTest("年度燈：createAnnualLanternGroup 建立**單一** ANNUAL_LANTERN TempleEvent（非四個）", async () => {
  const { prisma, templeEvents } = await load();
  const year = 990;
  try {
    const res = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    assert.equal(res.ok, true);
    const events = await prisma.templeEvent.findMany({ where: { year } });
    assert.equal(events.length, 1, "每年只有一個年度燈 TempleEvent");
    assert.equal(events[0].activityType, "ANNUAL_LANTERN");
    // 四個項目型別都掛在 ANNUAL_LANTERN 底下。
    const items = await prisma.registrationItemType.findMany({
      where: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY", "LANTERN_PURIFICATION"] } },
      select: { key: true, activityType: true },
    });
    assert.equal(items.length, 4);
    for (const it of items) assert.equal(it.activityType, "ANNUAL_LANTERN", `${it.key} 應為 ANNUAL_LANTERN`);
    // 冪等：再次呼叫仍為單一事件。
    await templeEvents.createAnnualLanternGroup({ year }, "測試");
    assert.equal((await prisma.templeEvent.count({ where: { year } })), 1, "冪等：不重複建立");
  } finally {
    await cleanupYear(prisma, year);
  }
});

// ── 五＋六、全戶多人多項目一次送出＋祭改→小人頭列印 ─────────────

dbTest("全戶多人：一次送出光明/太歲/祭改＋全家燈 → 單一 RitualRecord；祭改建 PurificationEntry；重送 ALREADY_EXISTS", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 991;
  const hhId = `T${Math.random().toString(36).slice(2, 8)}`.slice(0, 10);
  try {
    await templeEvents.createAnnualLanternGroup({ year }, "測試");
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試家戶", address: "測試地址1號" } });
    const m1 = await prisma.member.create({ data: { householdId: hh.id, name: "測試甲", isPrimaryContact: true } });
    const m2 = await prisma.member.create({ data: { householdId: hh.id, name: "測試乙" } });

    const t = await prisma.registrationItemType.findMany({
      where: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_PURIFICATION"] } },
      select: { id: true, key: true },
    });
    const byKey = Object.fromEntries(t.map((x) => [x.key, x.id]));

    const before = await prisma.purificationEntry.count({ where: { templeEvent: { activityType: "ANNUAL_LANTERN", year } } });
    const result = await reg.registerItemsBatch(
      [
        { memberId: m1.id, registrationItemTypeId: byKey["LANTERN_GUANGMING"], year },
        { memberId: m1.id, registrationItemTypeId: byKey["LANTERN_PURIFICATION"], year },
        { memberId: m2.id, registrationItemTypeId: byKey["LANTERN_TAISUI"], year },
      ],
      "測試"
    );
    assert.equal(result.ok, true, "整批報名應成功");

    // 四項共用單一 RitualRecord（同戶同年 ANNUAL_LANTERN 只有一筆）。
    const records = await prisma.ritualRecord.findMany({ where: { householdId: hh.id, year, activityType: "ANNUAL_LANTERN" } });
    assert.equal(records.length, 1, "同戶同年年度燈只有一筆 RitualRecord");

    // 祭改建立了 PurificationEntry（掛在年度燈事件底下）。
    const after = await prisma.purificationEntry.count({ where: { templeEvent: { activityType: "ANNUAL_LANTERN", year } } });
    assert.equal(after, before + 1, "祭改應新增一筆 PurificationEntry");

    // 重送同一批 → 不重複（ALREADY_EXISTS，且 PurificationEntry 不增加）。
    const again = await reg.registerItemsBatch(
      [{ memberId: m1.id, registrationItemTypeId: byKey["LANTERN_PURIFICATION"], year }],
      "測試"
    );
    assert.equal(again.ok, true);
    if (again.ok) assert.ok(again.outcomes.every((o) => o.outcome === "ALREADY_EXISTS"), "重送應為 ALREADY_EXISTS");
    const after2 = await prisma.purificationEntry.count({ where: { templeEvent: { activityType: "ANNUAL_LANTERN", year } } });
    assert.equal(after2, after, "重送不重複建立 PurificationEntry");
  } finally {
    await cleanupYear(prisma, year, hhId);
  }
});

dbTest("祭改年度清單：年度燈事件（ANNUAL_LANTERN）列入 listPurificationYears", async () => {
  const { prisma, templeEvents, purification } = await load();
  const year = 992;
  try {
    await templeEvents.createAnnualLanternGroup({ year }, "測試");
    const years = await purification.listPurificationYears();
    assert.ok(years.some((y) => y.year === year), "年度燈事件應出現在祭改年度清單");
  } finally {
    await cleanupYear(prisma, year);
  }
});

dbTest("祭改列印串接：picker 建立的祭改在小人頭列印預覽中，姓名/地址由信眾/家戶自動帶入（零人工再輸入）", async () => {
  const { prisma, templeEvents, reg, purification } = await load();
  const year = 993;
  const hhId = `T${Math.random().toString(36).slice(2, 8)}`.slice(0, 10);
  try {
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    assert.equal(grp.ok, true);
    const eventId = grp.ok ? grp.data.landingId : "";
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試家戶", address: "台北市測試路九號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "王測試", gender: "男", isPrimaryContact: true } });
    const pur = await prisma.registrationItemType.findUnique({ where: { key: "LANTERN_PURIFICATION" }, select: { id: true } });

    // 透過與 picker 相同的整批後端建立祭改（只給 memberId，無任何人工姓名/地址/生日）。
    const r = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: pur!.id, year }], "測試");
    assert.equal(r.ok, true);

    // 小人頭列印預覽：資料全部由系統自動帶入（姓名來自信眾、地址來自家戶）。
    const preview = await purification.previewPurificationPrintBatch(eventId, { kind: "ALL" });
    assert.equal(preview.ok, true, "預覽應成功");
    if (preview.ok) {
      const flat = preview.data.pages.flat();
      const mine = flat.find((f) => f.view.displayName === "王測試");
      assert.ok(mine, "預覽應含該祭改，姓名自動帶入信眾");
      assert.equal(mine!.view.address, "台北市測試路九號", "地址自動帶入家戶");
      assert.equal(mine!.view.isTemporaryName, false, "非人工臨時輸入");
      assert.ok(mine!.ageResolution, "年度虛歲由系統計算");
    }
  } finally {
    await cleanupYear(prisma, year, hhId);
  }
});
