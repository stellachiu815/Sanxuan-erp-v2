import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R5.3 全家燈永久資料共用架構 Phase 2（只全家燈）——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r53FamilyDb.test.ts
 *
 * 驗證：預設全納入合格成員、逐位取消、辭世/刪除不可納入、至少一位、同年同戶不重複、
 * 年度快照（成員/地址/戶主）不可變、只產生應收不產生已收、交易失敗全 rollback。
 * 隔離：deterministic 短家戶 id（≤10）、唯一哨兵年度、pre-clean、FK 子→父 cleanup、不吞錯。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  const pricing = await import("../src/lib/annualLanternPricing");
  return { prisma, templeEvents, reg, pricing };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const SUITE = "F"; // 家戶編號 VarChar(10)；F+4 位年度=5 字元
const hhIdFor = (year: number) => `${SUITE}${year}`;
const FAMILY_PRICE = 3000;

async function familyKey(prisma: P) {
  const row = await prisma.registrationItemType.findFirst({ where: { key: "LANTERN_FAMILY" }, select: { id: true } });
  return row!.id;
}
async function recordIdOf(prisma: P, hhId: string, year: number) {
  const rec = await prisma.ritualRecord.findFirst({ where: { householdId: hhId, year, activityType: "ANNUAL_LANTERN" }, select: { id: true } });
  return rec?.id ?? "";
}
async function familyRegOf(prisma: P, hhId: string, year: number) {
  return prisma.familyLanternRegistration.findFirst({
    where: { householdId: hhId, year },
    include: { members: { orderBy: { createdAt: "asc" } } },
  });
}

async function cleanup(prisma: P, year: number, hhId: string) {
  // 全家燈快照（子→父）先於 members/household；item 刪除本會 cascade，但顯式刪除更保險。
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

/** 建立 ANNUAL_LANTERN 活動（全家燈單價 3000）＋家戶。回傳建立函式供各測試補成員。 */
async function setupEvent(prisma: P, templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"], year: number, hhId: string, contactName?: string) {
  await cleanup(prisma, year, hhId);
  const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
  assert.equal(grp.ok, true, grp.ok ? "" : `建立年度燈失敗：${grp.error}`);
  const { updateAnnualLanternPrices } = await import("../src/lib/annualLanternPricing");
  if (grp.ok) await updateAnnualLanternPrices(grp.data.landingId, { familyLanternUnitPrice: FAMILY_PRICE });
  await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號", contactName: contactName ?? null } });
}

// 戶主快照優先序（純函式；gated 因 familyLantern 匯入 prisma，於 Mac 執行）
dbTest("戶主優先序：HEAD > PRIMARY > contactName > UNSET（只在有效成員中挑）", async () => {
  const { resolveFamilyContact } = await import("../src/lib/familyLantern");
  const head = { id: "1", name: "頭", role: "HOUSEHOLD_HEAD", isPrimaryContact: false };
  const primary = { id: "2", name: "聯", role: "OTHER", isPrimaryContact: true };
  const other = { id: "3", name: "其", role: "OTHER", isPrimaryContact: false };
  assert.deepEqual(resolveFamilyContact([head, primary, other], "戶主名"), { name: "頭", source: "HEAD" });
  assert.deepEqual(resolveFamilyContact([primary, other], "戶主名"), { name: "聯", source: "PRIMARY" });
  assert.deepEqual(resolveFamilyContact([other], "戶主名"), { name: "戶主名", source: "CONTACT_NAME" });
  assert.deepEqual(resolveFamilyContact([other], null), { name: null, source: "UNSET" });
  assert.deepEqual(resolveFamilyContact([], "  "), { name: null, source: "UNSET" });
});

// ① 五位合格成員預設全納入 → 1 item＋1 快照＋5 成員；只產生應收、不產生已收
dbTest("① 五位合格成員全納入：1 全家燈 item＋1 快照＋5 成員；應收=3000、已收=0", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 8801;
  const hhId = hhIdFor(year);
  try {
    await setupEvent(prisma, templeEvents, year, hhId);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const m = await prisma.member.create({ data: { householdId: hhId, name: `成員${i}`, role: i === 0 ? "HOUSEHOLD_HEAD" : "OTHER", isPrimaryContact: i === 0 } });
      ids.push(m.id);
    }
    const famId = await familyKey(prisma);
    const r = await reg.registerItemsBatch([{ memberId: ids[0], registrationItemTypeId: famId, year, participantMemberIds: ids }], "測試", null);
    assert.equal(r.ok, true, r.ok ? "" : `報名失敗：${r.error}`);

    const items = await prisma.ritualRegistrationItem.findMany({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year } } });
    assert.equal(items.length, 1, "全家燈只有 1 筆 item");
    assert.equal(Number(items[0].amountDue), FAMILY_PRICE, "應收=年度單價 3000");
    assert.equal(Number(items[0].amountPaid), 0, "不產生已收款");

    const regRow = await familyRegOf(prisma, hhId, year);
    assert.ok(regRow, "有 1 筆 FamilyLanternRegistration");
    assert.equal(regRow.members.length, 5, "5 位成員快照");
    assert.equal(regRow.addressSnapshot, "測試路1號", "地址快照");
    assert.equal(regRow.contactSourceSnapshot, "HEAD", "戶主來源＝HOUSEHOLD_HEAD");
    assert.equal(regRow.contactNameSnapshot, "成員0", "戶主姓名快照");
    assert.deepEqual(regRow.members.map((m: { memberNameSnapshot: string }) => m.memberNameSnapshot).sort(), ["成員0", "成員1", "成員2", "成員3", "成員4"], "姓名快照");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ② 取消兩位 → 只 3 位快照；③ 辭世/刪除不可納入（送入即 rollback）
dbTest("② 只納入 3 位 → 3 位快照；③ 辭世成員被送入 → 400 rollback、無全家燈建立", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 8802;
  const hhId = hhIdFor(year);
  try {
    await setupEvent(prisma, templeEvents, year, hhId);
    const live = [];
    for (let i = 0; i < 4; i++) live.push((await prisma.member.create({ data: { householdId: hhId, name: `活${i}`, isPrimaryContact: i === 0 } })).id);
    const dead = (await prisma.member.create({ data: { householdId: hhId, name: "歿者", isDeceased: true } })).id;
    const famId = await familyKey(prisma);

    // ② 只納入前 3 位活成員。
    const r = await reg.registerItemsBatch([{ memberId: live[0], registrationItemTypeId: famId, year, participantMemberIds: live.slice(0, 3) }], "測試", null);
    assert.equal(r.ok, true, r.ok ? "" : `報名失敗：${r.error}`);
    const reg1 = await familyRegOf(prisma, hhId, year);
    assert.equal(reg1!.members.length, 3, "只 3 位快照");

    // ③ 另一年度：送入辭世成員 → 應 rollback（400），不得建立全家燈。
    const y2 = 8812;
    const hh2 = hhIdFor(y2);
    await setupEvent(prisma, templeEvents, y2, hh2);
    const m2 = (await prisma.member.create({ data: { householdId: hh2, name: "活A" } })).id;
    const d2 = (await prisma.member.create({ data: { householdId: hh2, name: "歿B", isDeceased: true } })).id;
    const bad = await reg.registerItemsBatch([{ memberId: m2, registrationItemTypeId: famId, year: y2, participantMemberIds: [m2, d2] }], "測試", null);
    assert.equal(bad.ok, false, "送入辭世成員應失敗");
    assert.equal(await prisma.familyLanternRegistration.count({ where: { householdId: hh2 } }), 0, "rollback：無全家燈快照");
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year: y2 } } }), 0, "rollback：無全家燈 item");
    await cleanup(prisma, y2, hh2);
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ④ 戶主 UNSET：無 head/primary/contactName → contactNameSnapshot null、source UNSET
dbTest("④ 無戶主/主要聯絡人/contactName → 快照 contactSource=UNSET、contactName=null", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 8803;
  const hhId = hhIdFor(year);
  try {
    await setupEvent(prisma, templeEvents, year, hhId); // contactName 未設
    const m = (await prisma.member.create({ data: { householdId: hhId, name: "甲", role: "OTHER", isPrimaryContact: false } })).id;
    const famId = await familyKey(prisma);
    await reg.registerItemsBatch([{ memberId: m, registrationItemTypeId: famId, year, participantMemberIds: [m] }], "測試", null);
    const regRow = await familyRegOf(prisma, hhId, year);
    assert.equal(regRow!.contactSourceSnapshot, "UNSET");
    assert.equal(regRow!.contactNameSnapshot, null, "不把「尚未設定」存入 DB");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ⑤ 零位合格成員 → 禁止建立；⑥ 同年同戶重複送出不新增第二筆
dbTest("⑤ 零合格成員 → 禁止；⑥ 同年同戶重送 → 仍 1 item / 1 快照（更新非新增）", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 8804;
  const hhId = hhIdFor(year);
  try {
    await setupEvent(prisma, templeEvents, year, hhId);
    const famId = await familyKey(prisma);
    // ⑤ 尚無成員（或全辭世）→ participantMemberIds 空 → 失敗。
    const dead = (await prisma.member.create({ data: { householdId: hhId, name: "歿", isDeceased: true } })).id;
    const zero = await reg.registerItemsBatch([{ memberId: dead, registrationItemTypeId: famId, year, participantMemberIds: [] }], "測試", null);
    assert.equal(zero.ok, false, "零位不得建立");

    // ⑥ 加入活成員後兩次送出。
    const a = (await prisma.member.create({ data: { householdId: hhId, name: "活甲", isPrimaryContact: true } })).id;
    const b = (await prisma.member.create({ data: { householdId: hhId, name: "活乙" } })).id;
    await reg.registerItemsBatch([{ memberId: a, registrationItemTypeId: famId, year, participantMemberIds: [a, b] }], "測試", null);
    // 再次送出（不同「第一位」也不得視為新報名）。
    await reg.registerItemsBatch([{ memberId: b, registrationItemTypeId: famId, year, participantMemberIds: [a, b] }], "測試", null);
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year } } }), 1, "仍 1 筆全家燈 item");
    assert.equal(await prisma.familyLanternRegistration.count({ where: { householdId: hhId } }), 1, "仍 1 筆快照");
    const regRow = await familyRegOf(prisma, hhId, year);
    assert.equal(regRow!.members.length, 2, "快照成員 2 位");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ⑫⑬⑭ 年度快照不可變：建立後改地址/新增成員/設辭世，舊年度快照不變
dbTest("⑫⑬⑭ 建立後改 Household.address／新增成員／設辭世 → 舊年度快照不變", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 8805;
  const hhId = hhIdFor(year);
  try {
    await setupEvent(prisma, templeEvents, year, hhId);
    const a = (await prisma.member.create({ data: { householdId: hhId, name: "甲", role: "HOUSEHOLD_HEAD" } })).id;
    const b = (await prisma.member.create({ data: { householdId: hhId, name: "乙" } })).id;
    const famId = await familyKey(prisma);
    await reg.registerItemsBatch([{ memberId: a, registrationItemTypeId: famId, year, participantMemberIds: [a, b] }], "測試", null);
    const before = await familyRegOf(prisma, hhId, year);
    assert.equal(before!.members.length, 2);
    assert.equal(before!.addressSnapshot, "測試路1號");

    // 之後：改地址、改甲名、新增成員、設乙辭世。
    await prisma.household.update({ where: { id: hhId }, data: { address: "改過的地址999" } });
    await prisma.member.update({ where: { id: a }, data: { name: "甲改名" } });
    await prisma.member.create({ data: { householdId: hhId, name: "新丙" } });
    await prisma.member.update({ where: { id: b }, data: { isDeceased: true } });

    const after = await familyRegOf(prisma, hhId, year);
    assert.equal(after!.addressSnapshot, "測試路1號", "舊年度地址快照不變");
    assert.equal(after!.members.length, 2, "舊年度名單不因新增成員增加");
    assert.deepEqual(after!.members.map((m: { memberNameSnapshot: string }) => m.memberNameSnapshot).sort(), ["乙", "甲"], "姓名快照維持建立當時（甲未變甲改名、乙保留）");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
