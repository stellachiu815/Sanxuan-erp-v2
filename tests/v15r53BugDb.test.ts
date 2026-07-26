import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R5.3 正式站兩個回歸 Bug 的 DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r53BugDb.test.ts
 *
 * Bug1：年度燈草稿頁生日/生肖/虛歲/太歲全是「—」——buildLanternPrintBatch 未確認時退回成員現值。
 * Bug2：確認報名被「年度燈報名尚未設定金額」誤擋——validateForConfirm 改讀 item＋祭改應收、不依賴已收款。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  const pricing = await import("../src/lib/annualLanternPricing");
  const activityReg = await import("../src/lib/activityRegistration");
  const lantern = await import("../src/lib/lanternRegistration");
  const completeness = await import("../src/lib/completenessGate");
  return { prisma, templeEvents, reg, pricing, activityReg, lantern, completeness };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const SUITE = "B"; // 家戶編號 VarChar(10)
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function familyKeyless(prisma: P, key: string) {
  const row = await prisma.registrationItemType.findFirst({ where: { key }, select: { id: true } });
  return row!.id;
}
async function recordIdOf(prisma: P, hhId: string, year: number) {
  const rec = await prisma.ritualRecord.findFirst({ where: { householdId: hhId, year, activityType: "ANNUAL_LANTERN" }, select: { id: true } });
  return rec?.id ?? "";
}
async function cleanup(prisma: P, year: number, hhId: string) {
  await prisma.familyLanternMember.deleteMany({ where: { familyLanternRegistration: { householdId: hhId } } });
  await prisma.familyLanternRegistration.deleteMany({ where: { householdId: hhId } });
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.lanternRegistration.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.purificationEntry.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.ritualRecord.deleteMany({ where: { householdId: hhId } });
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  await prisma.household.deleteMany({ where: { id: hhId } });
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } });
  await prisma.templeEvent.deleteMany({ where: { year } });
}

// Bug1 + Bug2 一次驗證：草稿年度燈頁顯示生日/生肖/虛歲/太歲；未收款可確認。
dbTest("Bug1+2：草稿年度燈顯示成員現值（含只有國曆者）；未收款(amountPaid=0)即可確認；應收讀 item", async () => {
  const { prisma, templeEvents, reg, pricing, activityReg, lantern, completeness } = await load();
  const year = 8901;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId);
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    assert.equal(grp.ok, true);
    if (grp.ok) await pricing.updateAnnualLanternPrices(grp.data.landingId, { brightLightUnitPrice: 500 });
    await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
    // 成員甲：完整農曆生日（西元1957＝民國46、7/18）＋性別。
    const m = await prisma.member.create({
      data: { householdId: hhId, name: "邱明宏", gender: "男", isPrimaryContact: true, lunarBirthYear: 1957, lunarBirthMonth: 7, lunarBirthDay: 18 },
    });
    // 成員乙：**只有國曆生日**、沒有任何農曆欄位（很多匯入信眾如此）——驗證退回會由 solarToLunar 補齊。
    const mSolar = await prisma.member.create({
      data: { householdId: hhId, name: "林國曆", gender: "女", solarBirthDate: new Date(Date.UTC(1970, 4, 20)) },
    });
    const gm = await familyKeyless(prisma, "LANTERN_GUANGMING");

    const r = await reg.registerItemsBatch(
      [
        { memberId: m.id, registrationItemTypeId: gm, year },
        { memberId: mSolar.id, registrationItemTypeId: gm, year },
      ],
      "測試",
      null
    );
    assert.equal(r.ok, true, r.ok ? "" : `報名失敗：${r.error}`);
    const recordId = await recordIdOf(prisma, hhId, year);

    // ── Bug1：草稿（未確認、無快照）→ buildLanternPrintBatch 退回成員現值，不是「—」──
    const batch = await lantern.buildLanternPrintBatch(recordId);
    assert.ok(batch, "有年度燈批次");
    assert.equal(batch!.isConfirmed, false, "草稿");
    const row = batch!.rows.find((r) => r.memberId === m.id);
    assert.ok(row, "有農曆成員列");
    assert.equal(row!.snapshotMissing, true, "草稿無快照");
    assert.notEqual(row!.lunarBirthText, "", "農曆生日現算不為空");
    assert.ok(row!.zodiac, "生肖現算有值（非 —）");
    assert.notEqual(row!.nominalAgeText, "", "虛歲現算不為空");
    // 只有國曆者：由 solarToLunar 補齊，生肖／虛歲／農曆生日一樣不得為「—」──
    const rowSolar = batch!.rows.find((r) => r.memberId === mSolar.id);
    assert.ok(rowSolar, "有國曆成員列");
    assert.notEqual(rowSolar!.lunarBirthText, "", "國曆→農曆生日換算不為空");
    assert.ok(rowSolar!.zodiac, "國曆成員生肖現算有值（非 —）");
    assert.notEqual(rowSolar!.nominalAgeText, "", "國曆成員虛歲現算不為空");

    // ── Bug1 應收：批次應收讀 item（500×2 人），非 LanternRegistration ──
    assert.equal(batch!.amountDue, 1000, "應收＝年度燈 item 500×2");
    assert.equal(batch!.amountPaid, 0, "未收款");
    assert.equal(batch!.amountUnpaid, 1000, "未收 1000");

    // ── Bug2：完全比照正式 POST /confirm 兩道關卡：先 completeness、再 validateForConfirm ──
    const comp = await completeness.checkRitualRecordCompleteness(recordId);
    assert.equal(comp.complete, true, comp.complete ? "" : `資料未完整：${comp.missing.map((x) => x.label).join("、")}`);
    const item = await prisma.ritualRegistrationItem.findFirst({ where: { memberId: m.id, registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } });
    assert.equal(Number(item!.amountDue), 500, "item 應收 500");
    assert.equal(Number(item!.amountPaid), 0, "amountPaid=0");
    assert.equal(Number(item!.amountUnpaid), 500, "amountUnpaid=500");
    const v = await activityReg.validateForConfirm(recordId);
    assert.equal(v.ok, true, v.ok ? "" : `確認被擋：${JSON.stringify(v.reasons)}`);

    // 確認成功（DRAFT→CONFIRMED），且不需先收款。
    const confirmed = await activityReg.confirmRegistration(recordId, "測試");
    assert.equal(confirmed.ok, true, confirmed.ok ? "" : `確認失敗：${confirmed.error}`);
    const after = await prisma.ritualRecord.findUnique({ where: { id: recordId }, select: { status: true } });
    assert.equal(after!.status, "CONFIRMED", "已確認");
    // 確認後應收不變、仍未收款（收款是獨立流程）。
    const item2 = await prisma.ritualRegistrationItem.findFirst({ where: { memberId: m.id, registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } });
    assert.equal(Number(item2!.amountPaid), 0, "確認後仍 amountPaid=0");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// Bug2 反面：未設定年度單價（amountDue=0）→ 確認被擋，訊息為單價提示（非『尚未設定金額』/收款相關）。
dbTest("Bug2 反面：未設年度單價(應收0)→確認被擋且訊息為年度單價提示", async () => {
  const { prisma, templeEvents, reg, activityReg } = await load();
  const year = 8902;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId);
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試"); // 不設單價
    assert.equal(grp.ok, true);
    await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
    const m = await prisma.member.create({ data: { householdId: hhId, name: "甲", gender: "男", lunarBirthYear: 1957, lunarBirthMonth: 7, lunarBirthDay: 18 } });
    const gm = await familyKeyless(prisma, "LANTERN_GUANGMING");
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: gm, year }], "測試", null);
    const recordId = await recordIdOf(prisma, hhId, year);
    const v = await activityReg.validateForConfirm(recordId);
    assert.equal(v.ok, false, "應收 0 應被擋");
    if (!v.ok) assert.equal(v.reasons.some((r) => r.includes("年度單價")), true, "訊息為年度單價提示，非收款相關");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
