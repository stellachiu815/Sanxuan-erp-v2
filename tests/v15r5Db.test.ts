import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R5 金流 DB 級整合測試——證明「一筆報名只產生一份應收」（待 Mac）。
 *
 * 需真實測試資料庫與已 `prisma generate` 的 client：
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r5Db.test.ts
 *
 * 涵蓋：單一祭改／多位祭改／單一全家燈／多戶全家燈／同一人祭改＋光明燈／重複提交／
 * 編輯數量／取消項目／沿用去年不複製付款。核心斷言：
 *   - 祭改應收只在 PurificationEntry（feeStatus=CHARGEABLE、amountDue=單價）；其
 *     RitualRegistrationItem amountDue=0；不產生 LanternRegistration。
 *   - 全家燈應收只在 RitualRegistrationItem（amountDue=單價）；ANNUAL_LANTERN record
 *     不產生 LanternRegistration。
 *   - 光明燈自身計價（defaultUnitPrice×數量）；與祭改各自一份，不雙重。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  const pricing = await import("../src/lib/annualLanternPricing");
  const ritual = await import("../src/lib/ritual");
  return { prisma, templeEvents, reg, pricing, ritual };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

/**
 * 測試隔離策略（不得手動刪正式資料、可從 Ctrl+C／前次失敗殘留自動恢復）：
 *  - 年度使用 9xx「測試哨兵年度」（民國 9xx = 西元 2881+，正式資料不會使用）；每條案例年度唯一。
 *  - 家戶 id 即「家戶編號」欄位（Household.id 為 @db.VarChar(10)），故識別碼必須 ≤ 10 字元：
 *    用短前綴＋案例年度（deterministic），例：TST980（6 字元）。不得把長字串塞進此欄位。
 *  - **家戶相關子表一律以 householdId 涵蓋「所有年度」刪除**（沿用去年測試同一戶跨 y1/y2），
 *    否則只用年度條件時，另一年度的 RitualParticipant 仍以 memberId(onDelete: Restrict) 參照 Member，
 *    導致刪 Member 時 FK 失敗。cleanup 依 FK 子→父，且**不吞錯**（失敗即 fail，不留殘留）。
 */
const SUITE = "TST"; // 家戶編號 VarChar(10)，前綴須短；TST+3~4 位年度 ≤ 10
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function itemKeys(prisma: P) {
  const rows = await prisma.registrationItemType.findMany({
    where: { key: { in: ["LANTERN_GUANGMING", "LANTERN_TAISUI", "LANTERN_FAMILY", "LANTERN_PURIFICATION"] } },
    select: { id: true, key: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
}

/**
 * 完整清除**本測試**建立的資料，依 FK 由子到親，不 catch（讓 FK 順序/殘留問題直接曝光，
 * cleanup 失敗測試即 fail，不得顯示 PASS）。家戶相關子表以 householdId（跨所有年度）刪除，
 * 確保 memberId(Restrict) 參照全部先移除；TempleEvent 非家戶範圍，以哨兵年度刪。
 * deleteMany 對 0 筆不拋錯，故可安全連續重跑（Ctrl+C 後恢復）。
 */
async function cleanup(prisma: P, year: number, hhId: string) {
  // 1) RitualRegistrationItem（FK→ritualRecord/entry(SetNull)/member/itemType）——本戶所有年度
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  // 2) UniversalSalvationEntry（FK→detail；被 item 以 SetNull 參照）
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { householdId: hhId } } } });
  // 3) UniversalSalvationDetail（FK→ritualRecord）
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  // 4) LanternRegistration（FK→ritualRecord Cascade）
  await prisma.lanternRegistration.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  // 5) PurificationEntry（FK→ritualRecord Cascade、member(可空)）——本戶所有年度，先於 Member
  await prisma.purificationEntry.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  // 6) RitualParticipant（FK→ritualRecord Cascade、member onDelete:Restrict）——**本戶所有年度**，關鍵：先於 Member
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { householdId: hhId } } });
  // 7) RitualRecord（FK→templeEvent/household）——本戶所有年度
  await prisma.ritualRecord.deleteMany({ where: { householdId: hhId } });
  // 8) WorshipRecord（FK→household/member）
  await prisma.worshipRecord.deleteMany({ where: { householdId: hhId } });
  // 9) Member（此時已無 item/participant/purification/worship 參照）
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  // 10) Household
  await prisma.household.deleteMany({ where: { id: hhId } });
  // 11) TempleEventChecklistItem（FK→templeEvent，非家戶範圍，以哨兵年度刪）
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } });
  // 12) TempleEvent（唯一鍵 activityType_year；清掉才不會 409）
  await prisma.templeEvent.deleteMany({ where: { year } });
}

dbTest("單一祭改：應收只在 PurificationEntry；item=0；無 LanternRegistration", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 980;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId); // pre-clean：恢復上一輪/中斷殘留
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    if (grp.ok) await pricing.updateAnnualLanternPrices(grp.data.landingId, { purificationUnitPrice: 300, familyLanternUnitPrice: 500 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);

    const r = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_PURIFICATION"], year }], "測試");
    assert.equal(r.ok, true);

    const entries = await prisma.purificationEntry.findMany({ where: { templeEvent: { activityType: "ANNUAL_LANTERN", year } } });
    assert.equal(entries.length, 1, "一筆 PurificationEntry");
    assert.equal(Number(entries[0].amountDue ?? 0), 300, "祭改應收=單價 300");

    const items = await prisma.ritualRegistrationItem.findMany({ where: { registrationItemType: { key: "LANTERN_PURIFICATION" }, ritualRecord: { year } } });
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].amountDue), 0, "祭改 item 應收=0（不雙重）");

    const lantern = await prisma.lanternRegistration.findMany({ where: { ritualRecord: { year } } });
    assert.equal(lantern.length, 0, "年度燈統一 record 不產生 LanternRegistration");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

dbTest("單一全家燈：應收只在 RitualRegistrationItem；無 LanternRegistration", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 981;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId); // pre-clean：恢復上一輪/中斷殘留
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    if (grp.ok) await pricing.updateAnnualLanternPrices(grp.data.landingId, { familyLanternUnitPrice: 1200 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);

    const r = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year }], "測試");
    assert.equal(r.ok, true);

    const items = await prisma.ritualRegistrationItem.findMany({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year } } });
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].amountDue), 1200, "全家燈應收=單價 1200（整戶一筆）");

    const lantern = await prisma.lanternRegistration.findMany({ where: { ritualRecord: { year } } });
    assert.equal(lantern.length, 0, "不產生 LanternRegistration（避免雙重）");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

dbTest("同一人祭改＋光明燈：各自一份應收，不雙重；重複提交 ALREADY_EXISTS 不增應收", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const year = 982;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId); // pre-clean：恢復上一輪/中斷殘留
    const grp = await templeEvents.createAnnualLanternGroup({ year }, "測試");
    assert.equal(grp.ok, true, grp.ok ? "" : `建立年度燈失敗：${grp.error}`);
    if (grp.ok) await pricing.updateAnnualLanternPrices(grp.data.landingId, { purificationUnitPrice: 300 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);

    const batch = await reg.registerItemsBatch(
      [
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_PURIFICATION"], year },
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year },
      ],
      "測試"
    );
    assert.equal(batch.ok, true, batch.ok ? "" : `整批報名失敗：${batch.error}`);
    const purEntries = await prisma.purificationEntry.count({ where: { templeEvent: { year } } });
    const gm = await prisma.ritualRegistrationItem.findMany({ where: { registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } });
    assert.equal(purEntries, 1, "祭改一筆 PurificationEntry");
    assert.equal(gm.length, 1);
    assert.ok(Number(gm[0].amountDue) > 0, "光明燈自身計價 > 0");

    // 重複提交：不新增。
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_PURIFICATION"], year }], "測試");
    assert.equal(await prisma.purificationEntry.count({ where: { templeEvent: { year } } }), 1, "重複提交不增 PurificationEntry");
    assert.equal(
      (await prisma.ritualRegistrationItem.count({ where: { registrationItemType: { key: "LANTERN_GUANGMING" }, ritualRecord: { year } } })),
      1,
      "重複提交不增光明燈 item"
    );
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

dbTest("沿用去年：讀去年內容、以新年度單價重算、不帶付款；一份應收", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const y1 = 970;
  const y2 = 971;
  const hhId = hhIdFor(y1); // 同一戶跨 y1/y2；家戶子表以 householdId 跨年度清除
  try {
    // pre-clean：兩個年度都先清（恢復上一輪/中斷殘留），家戶子表一次以 householdId 全清。
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
    // 去年（y1）：全家燈單價 800，報名全家燈＋光明燈。
    const g1 = await templeEvents.createAnnualLanternGroup({ year: y1 }, "測試");
    if (g1.ok) await pricing.updateAnnualLanternPrices(g1.data.landingId, { familyLanternUnitPrice: 800 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);
    await reg.registerItemsBatch(
      [
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_GUANGMING"], year: y1 },
        { memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year: y1, participantMemberIds: [m.id] },
      ],
      "測試"
    );
    // 模擬去年已付款。
    await prisma.ritualRegistrationItem.updateMany({ where: { ritualRecord: { year: y1 } }, data: { amountPaid: 500 } });

    // 新年度（y2）：全家燈單價改 1000。
    const g2 = await templeEvents.createAnnualLanternGroup({ year: y2 }, "測試");
    if (g2.ok) await pricing.updateAnnualLanternPrices(g2.data.landingId, { familyLanternUnitPrice: 1000 });

    // 沿用去年：讀 y1 內容。
    const carry = await reg.getHouseholdAnnualLanternLastYear(hh.id, y2);
    assert.equal(carry.fromYear, y1);
    assert.equal(carry.hadFamily, true);
    // 依 carry 內容以 y2 送出（新年度重算單價）。
    const entries = carry.perMember.flatMap((pm) =>
      pm.itemKeys.map((k) => ({ memberId: pm.memberId, registrationItemTypeId: keys[k], year: y2 }))
    );
    entries.push({ memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year: y2 });
    await reg.registerItemsBatch(entries, "測試");

    const fam2 = await prisma.ritualRegistrationItem.findFirst({ where: { registrationItemType: { key: "LANTERN_FAMILY" }, ritualRecord: { year: y2 } } });
    assert.ok(fam2);
    assert.equal(Number(fam2!.amountDue), 1000, "新年度用新單價 1000（非去年 800）");
    assert.equal(Number(fam2!.amountPaid), 0, "不沿用去年付款（amountPaid=0）");
    assert.equal(fam2!.status, "DRAFT", "新年度為 DRAFT，不沿用 CONFIRMED/已完成");
  } finally {
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
  }
});

dbTest("普渡 tabletAddress：每筆牌位各自保存；缺地址草稿；正式確認/列印擋", async () => {
  const { prisma, ritual } = await load();
  const year = 972;
  const hhId = hhIdFor(year);
  try {
    await cleanup(prisma, year, hhId); // pre-clean：恢復上一輪/中斷殘留
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "家戶地址9號" } });
    // ⚠️ createUniversalSalvationEntry 需先有該年度的普渡 record（與正式匯入流程一致：
    //    先 createBlankUniversalSalvationRecord 再逐筆建立牌位）。
    await ritual.createBlankUniversalSalvationRecord(hh.id, year);
    // 祖先牌位甲：明確地址 A；乙：無地址（退回家戶地址）。
    const e1 = await ritual.createUniversalSalvationEntry(hh.id, year, { category: "ANCESTOR_LINE", displayName: "甲祖先", yangshangNames: ["某"], tabletAddress: "甲路1號" }, "測試");
    assert.equal(e1.ok, true, e1.ok ? "" : `建立甲祖先失敗：${e1.error}`);
    await ritual.createUniversalSalvationEntry(hh.id, year, { category: "ANCESTOR_LINE", displayName: "乙祖先", yangshangNames: ["某"], tabletAddress: "" }, "測試");

    const entries = await prisma.universalSalvationEntry.findMany({ where: { universalSalvation: { ritualRecord: { householdId: hh.id, year } } }, orderBy: { createdAt: "asc" } });
    assert.equal(entries.length, 2);
    assert.equal(entries[0].tabletAddress, "甲路1號", "甲保存自己的 Excel/輸入地址");
    assert.equal(entries[1].tabletAddress, "家戶地址9號", "乙缺地址→退回家戶地址（各自保存）");

    // 重新讀取仍有地址（DB 真的寫入）。
    const reread = await prisma.universalSalvationEntry.findUnique({ where: { id: entries[0].id }, select: { tabletAddress: true } });
    assert.equal(reread!.tabletAddress, "甲路1號");
  } finally {
    await cleanup(prisma, year, hhId); // cleanup 已完整涵蓋 entry/detail/record（不再吞錯的手動刪除）
  }
});

// ── 隔離自檢：連續重跑兩次均通過；不撞唯一鍵、不出現 FK error、不累積 participant/item/entry ──
dbTest("隔離自檢：跨年度同戶連續重跑兩次均乾淨（無 409、無 FK error、不累積）", async () => {
  const { prisma, templeEvents, reg, pricing } = await load();
  const y1 = 973;
  const y2 = 974;
  const hhId = hhIdFor(y1); // 同一戶跨兩年，重現「沿用去年」的 participant 跨年參照情境
  const runOnce = async () => {
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
    const g1 = await templeEvents.createAnnualLanternGroup({ year: y1 }, "測試");
    assert.equal(g1.ok, true, g1.ok ? "" : `建立 y1 年度燈失敗（可能撞唯一鍵/殘留）：${g1.error}`);
    if (g1.ok) await pricing.updateAnnualLanternPrices(g1.data.landingId, { familyLanternUnitPrice: 800 });
    const g2 = await templeEvents.createAnnualLanternGroup({ year: y2 }, "測試");
    assert.equal(g2.ok, true, g2.ok ? "" : `建立 y2 年度燈失敗（可能撞唯一鍵/殘留）：${g2.error}`);
    if (g2.ok) await pricing.updateAnnualLanternPrices(g2.data.landingId, { familyLanternUnitPrice: 900 });
    const hh = await prisma.household.create({ data: { id: hhId, name: "測試", address: "地址1號" } });
    const m = await prisma.member.create({ data: { householdId: hh.id, name: "甲", isPrimaryContact: true } });
    const keys = await itemKeys(prisma);
    // 兩年各建全家燈（有 participant），製造「member 被兩年 participant 參照」情境。
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year: y1, participantMemberIds: [m.id] }], "測試");
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["LANTERN_FAMILY"], year: y2, participantMemberIds: [m.id] }], "測試");
    // cleanup 必須不吞錯地成功刪除 member（先移除兩年 participant）；失敗會直接 throw → 測試 fail。
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
    // 清乾淨：不累積。
    assert.equal(await prisma.ritualParticipant.count({ where: { ritualRecord: { householdId: hhId } } }), 0, "participant 已清空");
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { ritualRecord: { householdId: hhId } } }), 0, "item 已清空");
    assert.equal(await prisma.ritualRecord.count({ where: { householdId: hhId } }), 0, "record 已清空");
    assert.equal(await prisma.member.count({ where: { householdId: hhId } }), 0, "member 已清空（無 FK 殘留）");
    assert.equal(await prisma.household.count({ where: { id: hhId } }), 0, "household 已清空");
    assert.equal(await prisma.templeEvent.count({ where: { year: { in: [y1, y2] } } }), 0, "templeEvent 已清空");
  };
  try {
    await runOnce(); // 第一次：完整建立→cleanup 乾淨
    await runOnce(); // 第二次：不得撞 409、不得 FK error、不得累積
  } finally {
    await cleanup(prisma, y1, hhId);
    await cleanup(prisma, y2, hhId);
  }
});
