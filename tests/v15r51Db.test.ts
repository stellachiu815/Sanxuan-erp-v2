import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R5.1 年度燈四項目各自逐年單價——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r51Db.test.ts
 *
 * 驗證：四項年度單價可分別存讀、彼此獨立；報名一律由伺服器依「該年度活動單價」重算 amountDue
 *（光明/太歲不再讀 defaultUnitPrice、不寫死 500；前端亂送金額不採信）；祭改只一份 PurificationEntry、
 * 全家燈只一份 item；沿用去年用新年度價；重複提交不增筆/不改額；未設定＝0。
 *
 * 測試隔離：deterministic 短家戶 id（≤10）、每案例唯一哨兵年度（97xx）、setup 前 pre-clean、
 * cleanup 依 FK 子→父且不吞錯（家戶子表以 householdId 跨年度刪，避免 participant.memberId Restrict）。
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

const SUITE = "L"; // 家戶編號 VarChar(10)；L+4 位年度=5 字元
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function itemKeys(prisma: P) {
  const rows = await prisma.registrationItemType.findMany({
    where: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY", "LANTERN_PURIFICATION"] } },
    select: { id: true, key: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
}

async function cleanup(prisma: P, year: number, hhId: string) {
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { householdId: hhId } } } });
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.lanternRegistration.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.purificationEntry.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  await prisma.ritualRecord.deleteMany({ where: { householdId: hhId } });
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  await prisma.household.deleteMany({ where: { id: hhId } });
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } });
  await prisma.templeEvent.deleteMany({ where: { year } });
}

/** 建立某年度 ANNUAL_LANTERN 活動＋一戶一員；回傳 landingId（年度燈事件 id）。 */
async function setup(
  prisma: P,
  templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"],
  year: number,
  hhId: string
) {
  await cleanup(prisma, year, hhId); // pre-clean：恢復殘留
  const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
  assert.equal(grp.ok, true, grp.ok ? "" : `建立年度燈失敗：${grp.error}`);
  const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
  const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
  const landingId = grp.ok ? grp.data.landingId : "";
  return { hh, m, landingId };
}

const itemAmount = async (prisma: P, year: number, key: string) => {
  const it = await prisma.ritualRegistrationItem.findFirst({ where: { registrationItemType: { key }, ritualRecord: { year }, deletedAt: null } });
  return it ? Number(it.amountDue) : null;
};

// ① 四項可分別儲存與讀取；② 改光明不影響太歲；③ 改太歲不影響光明
dbTest("① 四項年度單價可分別存讀，且彼此獨立（改一項不影響其他）", async () => {
  const { prisma, templeEvents, pricing } = await load();
  const year = 9701;
  const hhId = hhIdFor(year);
  try {
    const { landingId } = await setup(prisma, templeEvents, year, hhId);
    await pricing.updateAnnualLanternPrices(landingId, { brightLightUnitPrice: 500, taisuiLightUnitPrice: 700, familyLanternUnitPrice: 1000, purificationUnitPrice: 300 });
    let p = await pricing.getAnnualLanternPrices(year);
    assert.deepEqual(p, { brightLightUnitPrice: 500, taisuiLightUnitPrice: 700, familyLanternUnitPrice: 1000, purificationUnitPrice: 300 }, "四項分別存讀");

    // 只改光明 → 太歲/全家/祭改不變。
    await pricing.updateAnnualLanternPrices(landingId, { brightLightUnitPrice: 600 });
    p = await pricing.getAnnualLanternPrices(year);
    assert.equal(p.brightLightUnitPrice, 600, "光明已更新");
    assert.equal(p.taisuiLightUnitPrice, 700, "太歲不受影響");
    assert.equal(p.familyLanternUnitPrice, 1000, "全家燈不受影響");
    assert.equal(p.purificationUnitPrice, 300, "祭改不受影響");

    // 只改太歲 → 光明不變。
    await pricing.updateAnnualLanternPrices(landingId, { taisuiLightUnitPrice: 800 });
    p = await pricing.getAnnualLanternPrices(year);
    assert.equal(p.taisuiLightUnitPrice, 800, "太歲已更新");
    assert.equal(p.brightLightUnitPrice, 600, "光明不受影響");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ④ 四項同時報名各用自己年度價；⑤ 光明/太歲不依賴 defaultUnitPrice；⑥ 伺服器忽略前端 amountDue
// ⑧ 祭改一份 PurificationEntry；⑨ 全家燈一份 item
dbTest("④⑤⑥⑧⑨ 四項同批報名各用年度價；光明/太歲非 500；伺服器忽略前端金額；祭改/全家燈各一份", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 9702;
  const hhId = hhIdFor(year);
  try {
    const { m, landingId } = await setup(prisma, templeEvents, year, hhId);
    // 年度價：光明 600、太歲 700、全家 1000、祭改 300（皆非全域 defaultUnitPrice 500）。
    await pricing.updateAnnualLanternPrices(landingId, { brightLightUnitPrice: 600, taisuiLightUnitPrice: 700, familyLanternUnitPrice: 1000, purificationUnitPrice: 300 });
    const keys = await itemKeys(prisma);

    const batch = await reg.registerItemsBatch(
      [
        // 光明×2；並故意送入亂七八糟的 customAmount，驗證伺服器完全不採信、只用年度價。
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year, quantity: 2, customAmount: 99999 },
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_TAISUI"], year, quantity: 1, customAmount: 1 },
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year, participantMemberIds: [m.id] },
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_PURIFICATION"], year },
      ],
      "測試"
    );
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${batch.error}`);

    assert.equal(await itemAmount(prisma, year, "LANTERN_GUANGMING"), 1200, "光明=年度價 600×2（非 500、非前端 99999）");
    assert.equal(await itemAmount(prisma, year, "LANTERN_TAISUI"), 700, "太歲=年度價 700（非 500、非前端 1）");
    assert.equal(await itemAmount(prisma, year, "LANTERN_FAMILY"), 1000, "全家燈=年度價 1000（整戶一份）");
    // 祭改：一份 PurificationEntry（300），其 item 金額 0（不雙重）。
    const purs = await prisma.purificationEntry.findMany({ where: { templeEvent: { year } } });
    assert.equal(purs.length, 1, "祭改只有一份 PurificationEntry");
    assert.equal(Number(purs[0].amountDue ?? 0), 300, "祭改應收=年度價 300");
    assert.equal(await itemAmount(prisma, year, "LANTERN_PURIFICATION"), 0, "祭改 item 金額 0（不雙重應收）");
    // 全家燈只有一份 item、且不產生 LanternRegistration。
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year } } }), 1, "全家燈只有一份 item");
    assert.equal(await prisma.lanternRegistration.count({ where: { ritualRecord: { year } } }), 0, "不產生 LanternRegistration");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ⑩ 重複提交不增加 item/entry/amountDue
dbTest("⑩ 重複提交不增加 item、不改 amountDue", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 9703;
  const hhId = hhIdFor(year);
  try {
    const { m, landingId } = await setup(prisma, templeEvents, year, hhId);
    await pricing.updateAnnualLanternPrices(landingId, { brightLightUnitPrice: 600 });
    const keys = await itemKeys(prisma);
    const entry = [{ memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year, quantity: 2 }];

    await reg.registerItemsBatch(entry, "測試");
    const n1 = await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } });
    const a1 = await itemAmount(prisma, year, "LANTERN_GUANGMING");
    await reg.registerItemsBatch(entry, "測試");
    const n2 = await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } });
    const a2 = await itemAmount(prisma, year, "LANTERN_GUANGMING");
    assert.equal(n2, n1, "重複提交不增加 item");
    assert.equal(a2, a1, "重複提交不改 amountDue");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ⑦ 沿用去年用新年度價（不帶去年價/付款）
dbTest("⑦ 沿用去年：光明燈以新年度價重算（去年 500→今年 600）", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const y1 = 9704;
  const y2 = 9705;
  const hhId = hhIdFor(y1);
  try {
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
    const g1 = await templeEvents.createAnnualLanternGroup({ year: y1 }, "測試");
    assert.equal(g1.ok, true);
    if (g1.ok) await pricing.updateAnnualLanternPrices(g1.data.landingId, { brightLightUnitPrice: 500 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year: y1 }], "測試");
    await prisma.ritualRegistrationItem.updateMany({ where: { ritualRecord: { year: y1 } }, data: { amountPaid: 200 } }); // 去年已付款

    const g2 = await templeEvents.createAnnualLanternGroup({ year: y2 }, "測試");
    assert.equal(g2.ok, true);
    if (g2.ok) await pricing.updateAnnualLanternPrices(g2.data.landingId, { brightLightUnitPrice: 600 }); // 今年改 600

    const carry = await reg.getHouseholdAnnualLanternLastYear(hh.id, y2);
    assert.equal(carry.fromYear, y1, "沿用去年讀 y1");
    const entries = carry.perMember.flatMap((pm) => pm.itemKeys.map((k) => ({ memberId: pm.memberId, registrationItemTypeId: keys[k], year: y2 })));
    await reg.registerItemsBatch(entries, "測試");

    const gm2 = await prisma.ritualRegistrationItem.findFirst({ where: { registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year: y2 } } });
    assert.ok(gm2, "今年有光明燈報名");
    assert.equal(Number(gm2!.amountDue), 600, "以新年度價 600 重算（非去年 500）");
    assert.equal(Number(gm2!.amountPaid), 0, "不沿用去年付款");
    assert.equal(gm2!.status, "DRAFT", "新年度為 DRAFT");
  } finally {
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
  }
});

// ⑪ 未設定價格 → API 回 null；報名該項 amountDue 0（UI/API/報名一致）
dbTest("⑪ 未設定價格：API 回 null、報名該項 amountDue=0（一致）", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 9706;
  const hhId = hhIdFor(year);
  try {
    const { m } = await setup(prisma, templeEvents, year, hhId); // 不設任何單價
    const p = await pricing.getAnnualLanternPrices(year);
    assert.deepEqual(p, { brightLightUnitPrice: null, taisuiLightUnitPrice: null, familyLanternUnitPrice: null, purificationUnitPrice: null }, "未設定＝四項皆 null");
    const keys = await itemKeys(prisma);
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year, quantity: 2 }], "測試");
    assert.equal(await itemAmount(prisma, year, "LANTERN_GUANGMING"), 0, "未設定 → 光明 amountDue 0（不寫死 500）");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
