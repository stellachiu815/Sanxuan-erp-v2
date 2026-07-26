import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R5 命名牌位「建立報名即建立 linked Draft」＋不重複建立/計價——DB regression（待 Mac）。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v15r5DupDb.test.ts
 *
 * 正式規格（取代先前「0 元 placeholder，之後再認領」）：
 *   從信眾／家戶進入、按「建立報名」時，registerItemsBatch 對歷代祖先／乙位正魂／無緣子女
 *   當下就建立**完整或部分完整的 linked Draft**：
 *     - 有既有牌位資料 → 直接帶入 tabletName／tabletAddress／yangshangNames，並連結 entry↔item；
 *     - 無既有資料 → 仍只建 1 筆 Draft（entry＋item，1:1），先帶入地址與陽上人、tabletName 留空；
 *     - 一律**不留獨立 placeholder、畫面不得出現「牌位資料待確認」作為另一個報名項目**。
 *   金額：amountDue 只讀唯一價格來源（該年度活動 getUniversalSalvationTabletPrices），不重複計算。
 *   冤親（US_YUANQIN）以成員為主：一位成員一筆、顯示「累世冤親債主｜當事人姓名」。
 *   冪等：重送 / 重新進入編輯器 / 儲存修改，都不增加 entry 或 item、不改金額。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const templeEvents = await import("../src/lib/templeEvents");
  const reg = await import("../src/lib/registrationItemRegistration");
  const ritual = await import("../src/lib/ritual");
  return { prisma, templeEvents, reg, ritual };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];

const TABLET_UNIT = 2500;
const SPONSOR_UNIT = 800;

/**
 * 測試隔離策略（不得手動刪正式資料、可從 Ctrl+C 中斷自動恢復）：
 *  - 年度一律使用 96xx「測試哨兵年度」——民國 96xx = 西元 11510+，正式資料絕不可能使用，
 *    因此以 year 範圍刪除 ritual/TempleEvent 只會清到本測試資料。
 *  - 家戶 id 即「家戶編號」欄位（Household.id 為 @db.VarChar(10)），故測試識別碼必須**≤ 10 字元**：
 *    用短前綴＋該案例年度（deterministic），例：TST9609（7 字元）。不得把長字串塞進此欄位。
 *    上一輪殘留的家戶 id 與本輪相同，pre-clean 能精準刪除；只刪帶本前綴/本年度的資料，不碰正式家戶。
 *  - 每條案例使用**不同年度**（唯一 activity 唯一鍵 activityType_year），案例之間互不干擾。
 *  - setup 進入時先 cleanup（pre-clean 恢復），finally 再 cleanup（post-clean）。
 */
const SUITE = "TST"; // 家戶編號欄位 VarChar(10)，前綴須短；TST+4 位年度=7 字元 ≤ 10
const hhIdFor = (year: number) => `${SUITE}${year}`;

async function usItemKeys(prisma: P) {
  const rows = await prisma.registrationItemType.findMany({
    where: { key: { in: ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN", "US_SPONSOR"] } },
    select: { id: true, key: true },
  });
  return Object.fromEntries(rows.map((r) => [r.key, r.id])) as Record<string, string>;
}

/** 建立某年度中元普渡活動＋四類牌位單價（皆 2500）＋贊普固定價（800）＋一戶一員。 */
async function setup(
  prisma: P,
  templeEvents: Awaited<ReturnType<typeof load>>["templeEvents"],
  year: number,
  hhId: string,
  memberName = "邱明宏"
) {
  // pre-clean：先清掉上一輪（含被 Ctrl+C 中斷）殘留的同年度／同家戶資料，才不會撞
  //「這個年度、這種活動類型已經建立過活動了」(409)。只清本測試哨兵年度／本前綴家戶。
  await cleanup(prisma, year, hhId);
  const ev = await templeEvents.createTempleEvent({ activityType: "UNIVERSAL_SALVATION", year }, "測試");
  assert.equal(ev.ok, true, ev.ok ? "" : `建立普渡活動失敗：${ev.error}`);
  if (ev.ok) {
    await templeEvents.updateTempleEventTabletPrices(
      ev.data.id,
      { ancestorUnitPrice: TABLET_UNIT, zhenghunUnitPrice: TABLET_UNIT, yuanqinUnitPrice: TABLET_UNIT, wuyuanUnitPrice: TABLET_UNIT },
      "測試"
    );
    await templeEvents.updateTempleEventSponsorUnitPrice(ev.data.id, SPONSOR_UNIT, "測試");
  }
  const hh = await prisma.household.create({ data: { id: hhId, name: "測試戶", address: "測試路1號" } });
  const m = await prisma.member.create({ data: { householdId: hh.id, name: memberName, isPrimaryContact: true } });
  return { hh, m };
}

/** 種一筆本戶既有牌位（worship_records），供「建立報名自動帶入」。 */
async function seedWorship(prisma: P, hhId: string, type: "ANCESTOR_LINE" | "INDIVIDUAL", displayName: string, yangshang: string, location: string) {
  await prisma.worshipRecord.create({ data: { householdId: hhId, type, displayName, yangshangName: yangshang, location } });
}

async function itemsOf(prisma: P, year: number) {
  return prisma.ritualRegistrationItem.findMany({
    where: { ritualRecord: { year }, deletedAt: null },
    include: { registrationItemType: { select: { key: true } }, universalSalvationEntry: { select: { displayName: true, tabletAddress: true, yangshangNames: true } } },
    orderBy: { createdAt: "asc" },
  });
}
async function entriesOf(prisma: P, year: number, category?: string) {
  return prisma.universalSalvationEntry.findMany({
    where: { deletedAt: null, ...(category ? { category: category as never } : {}), universalSalvation: { ritualRecord: { year } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * 完整清除**本測試**建立的資料，依 FK 由子到親（不 catch，讓 FK 順序問題直接曝光）。
 * 範圍嚴格限縮：ritual/TempleEvent 以哨兵年度、家戶相關以本前綴 hhId；絕不碰正式資料。
 * deleteMany 對 0 筆不會拋錯，故可安全連續重跑（Ctrl+C 後恢復）。
 */
async function cleanup(prisma: P, year: number, hhId: string) {
  // 1) RitualRegistrationItem（FK→ritualRecord/entry(SetNull)/member/itemType）
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year } } });
  // 2) UniversalSalvationEntry（FK→detail、被 item 以 SetNull 參照；也被 worshipRecord 反向參照）
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { year } } } });
  // 3) UniversalSalvationDetail（FK→ritualRecord）
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { year } } });
  // 4) RitualParticipant（FK→ritualRecord/member）
  await prisma.ritualParticipant.deleteMany({ where: { ritualRecord: { year } } });
  // 5) RitualRecord（FK→templeEvent/household）
  await prisma.ritualRecord.deleteMany({ where: { year } });
  // 6) WorshipRecord（FK→household/member；entry 已刪，不再被參照）
  await prisma.worshipRecord.deleteMany({ where: { householdId: hhId } });
  // 7) Member（FK→household；已無 item/participant/worship 參照）
  await prisma.member.deleteMany({ where: { householdId: hhId } });
  // 8) Household
  await prisma.household.deleteMany({ where: { id: hhId } });
  // 9) TempleEventChecklistItem（FK→templeEvent）
  await prisma.templeEventChecklistItem.deleteMany({ where: { templeEvent: { year } } });
  // 10) TempleEvent（唯一鍵 activityType_year；清掉才不會 409）
  await prisma.templeEvent.deleteMany({ where: { year } });
}

// ── 新增 1：家戶已有祖先 → 建立報名即 linked，帶入 name/addr/yangshang，不需第二次 POST ──
dbTest("① 家戶已有祖先：建立報名當下即 1 item＋1 linked entry，且已帶入 name/addr/陽上人", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9601;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hh.id, "ANCESTOR_LINE", "陳姓歷代祖先", "陳大", "祖先路5號");
    const keys = await usItemKeys(prisma);

    // 只按「建立報名」——不再另外 POST entries。
    const batch = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${batch.error}`);

    const items = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR");
    assert.equal(items.length, 1, `建立報名後應只有 1 筆祖先 item，實得 ${items.length}`);
    assert.equal(items[0].universalSalvationEntryId !== null, true, "建立當下即 linked（不需第二次 POST entries）");
    assert.equal(items[0].universalSalvationEntry?.displayName, "陳姓歷代祖先", "已帶入既有祖先姓名");
    assert.equal(items[0].universalSalvationEntry?.tabletAddress, "祖先路5號", "已帶入既有牌位地址");
    assert.deepEqual(items[0].universalSalvationEntry?.yangshangNames, ["陳大"], "已帶入既有陽上人");
    assert.equal(Number(items[0].amountDue), TABLET_UNIT, "應收=唯一年度單價 2500（不重複計算）");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "只有 1 筆祖先 entry");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 新增 2：家戶已有乙位正魂 → 同上 ──
dbTest("② 家戶已有乙位正魂：建立報名當下即 1 item＋1 linked entry，已帶入 name/addr/陽上人", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9602;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hh.id, "INDIVIDUAL", "邱明宏乙位正魂", "邱小", "正魂路2號");
    const keys = await usItemKeys(prisma);

    const batch = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_ZHENGHUN"], year }], "測試");
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${batch.error}`);

    const items = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ZHENGHUN");
    assert.equal(items.length, 1, `建立報名後應只有 1 筆乙位正魂 item，實得 ${items.length}`);
    assert.equal(items[0].universalSalvationEntry?.displayName, "邱明宏乙位正魂", "已帶入既有乙位正魂姓名");
    assert.equal(items[0].universalSalvationEntry?.tabletAddress, "正魂路2號", "已帶入既有牌位地址");
    assert.deepEqual(items[0].universalSalvationEntry?.yangshangNames, ["邱小"], "已帶入既有陽上人");
    assert.equal(Number(items[0].amountDue), TABLET_UNIT, "應收=唯一年度單價 2500");
    assert.equal(items[0].universalSalvationEntryId !== null, true, "建立當下即 linked");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 新增 3：家戶沒有祖先 → 仍只建 1 draft（entry＋item），addr/陽上人帶入、name 空白、無 placeholder ──
dbTest("③ 家戶沒有祖先：建立 1 item＋1 draft entry；地址/陽上人已帶入、tabletName 空白、不留 placeholder", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9603;
  const hhId = hhIdFor(year);
  try {
    const { m } = await setup(prisma, templeEvents, year, hhId); // 無 worshipRecord=無既有祖先
    const keys = await usItemKeys(prisma);

    const batch = await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${batch.error}`);

    const items = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR");
    assert.equal(items.length, 1, `無既有祖先仍只建 1 筆（不得第二筆 placeholder），實得 ${items.length}`);
    assert.equal(items[0].universalSalvationEntryId !== null, true, "仍為 linked draft（非未連結 placeholder）");
    assert.equal(items[0].universalSalvationEntry?.displayName, "", "tabletName 留空，待使用者補（畫面顯示『尚缺牌位姓名』）");
    assert.equal(items[0].universalSalvationEntry?.tabletAddress, "測試路1號", "缺牌位地址→帶入家戶地址");
    // amountDue 只讀唯一年度單價來源；DRAFT 未確認不入待收（確認需先補牌位姓名）。
    assert.equal(Number(items[0].amountDue), TABLET_UNIT, "amountDue=唯一年度單價 2500（DRAFT，不重複計算）");
    assert.equal(items[0].status, "DRAFT", "為 DRAFT；未確認不進待收款");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "只有 1 筆 draft entry");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 冤親：member.name、一位一筆、重送不增 ──
dbTest("④ 累世冤親債主：顯示當事人姓名（=member.name）、一位成員一筆、重送不增", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9604;
  const hhId = hhIdFor(year);
  try {
    const { m } = await setup(prisma, templeEvents, year, hhId, "林來于");
    const keys = await usItemKeys(prisma);

    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_YUANQIN"], year }], "測試");
    let items = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_YUANQIN");
    assert.equal(items.length, 1, "一位成員勾一次只建 1 筆冤親");
    assert.equal(items[0].universalSalvationEntry?.displayName, "林來于", "當事人姓名來源=member.name（非類別名『累世冤親債主』）");
    assert.equal(Number(items[0].amountDue), TABLET_UNIT, "應收=年度單價 2500");

    // 重送同一成員：不新增（重新進入編輯器/重送皆冪等）。
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_YUANQIN"], year }], "測試");
    items = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_YUANQIN");
    assert.equal(items.length, 1, "重送同一成員仍只有 1 筆冤親");
    assert.equal((await entriesOf(prisma, year, "DEBT_CREDITOR")).length, 1, "冤親 entry 仍只有 1 筆");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 綜合：三牌位＋贊普 → 4 筆不得 7；總應收 8300 ──
dbTest("⑤ 同批次三牌位＋贊普（有既有祖先/乙位正魂）：共 4 筆不得變 7 筆，總應收=8300", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9605;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hh.id, "ANCESTOR_LINE", "邱姓歷代祖先", "邱大", "祖先路1號");
    await seedWorship(prisma, hh.id, "INDIVIDUAL", "邱明宏乙位正魂", "邱二", "正魂路1號");
    const keys = await usItemKeys(prisma);

    const batch = await reg.registerItemsBatch(
      [
        { memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year },
        { memberId: m.id, registrationItemTypeId: keys["US_ZHENGHUN"], year },
        { memberId: m.id, registrationItemTypeId: keys["US_YUANQIN"], year },
        { memberId: m.id, registrationItemTypeId: keys["US_SPONSOR"], year, customName: "林來于" },
      ],
      "測試"
    );
    assert.equal(batch.ok, true, batch.ok ? "" : `批次失敗：${batch.error}`);

    const items = await itemsOf(prisma, year);
    assert.equal(items.length, 4, `共 4 筆（祖先/乙位正魂/冤親/贊普），不得變 7 筆，實得 ${items.length}`);
    const byKey = (k: string) => items.filter((i) => i.registrationItemType.key === k);
    assert.equal(byKey("US_ANCESTOR").length, 1);
    assert.equal(byKey("US_ZHENGHUN").length, 1);
    assert.equal(byKey("US_YUANQIN").length, 1);
    assert.equal(byKey("US_SPONSOR").length, 1);
    // 三牌位皆 linked（無「牌位資料待確認」殘留）。
    const unlinkedTablet = items.filter((i) => ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN"].includes(i.registrationItemType.key) && i.universalSalvationEntryId === null);
    assert.equal(unlinkedTablet.length, 0, "三牌位皆連結實際 entry");
    const total = items.reduce((s, i) => s + Number(i.amountDue), 0);
    assert.equal(total, TABLET_UNIT * 3 + SPONSOR_UNIT, `總應收=2500×3＋800=8300（非 15800），實得 ${total}`);
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 新增 4：重新進入/重送 → item/entry 數不變、amountDue 不變（不重跑 create） ──
dbTest("⑥ 重新進入編輯器（重送 batch）：item/entry 數不變、amountDue 不變", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9606;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hh.id, "ANCESTOR_LINE", "邱姓歷代祖先", "邱大", "祖先路1號");
    const keys = await usItemKeys(prisma);
    const entry = [{ memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year }];

    await reg.registerItemsBatch(entry, "測試");
    const items1 = await itemsOf(prisma, year);
    const entries1 = await entriesOf(prisma, year);
    const amount1 = items1.map((i) => Number(i.amountDue));

    // 模擬使用者離開後重新進入、再次觸發建立報名。
    await reg.registerItemsBatch(entry, "測試");
    const items2 = await itemsOf(prisma, year);
    const entries2 = await entriesOf(prisma, year);

    assert.equal(items2.length, items1.length, "item 數不變");
    assert.equal(entries2.length, entries1.length, "entry 數不變");
    assert.deepEqual(items2.map((i) => Number(i.amountDue)), amount1, "amountDue 不變");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 新增 5：儲存修改 → update 原 entry，不 create 新 entry/item ──
dbTest("⑦ 儲存修改牌位：update 原 entry，不新增 entry、不新增 item", async () => {
  const { prisma, templeEvents, reg, ritual } = await load();
  const year = 9607;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    const keys = await usItemKeys(prisma);
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");

    const before = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(before.length, 1);
    const itemsBefore = await itemsOf(prisma, year);

    // 使用者在編輯器填入牌位姓名並儲存 → 走 update，不 create。
    const res = await ritual.updateUniversalSalvationEntry(hh.id, year, before[0].id, { displayName: "邱姓歷代祖先", tabletAddress: "新地址9號" }, "測試");
    assert.equal(res.ok, true, res.ok ? "" : `更新失敗：${res.error}`);

    const after = await entriesOf(prisma, year, "ANCESTOR_LINE");
    const itemsAfter = await itemsOf(prisma, year);
    assert.equal(after.length, 1, "儲存修改不新增 entry");
    assert.equal(itemsAfter.length, itemsBefore.length, "儲存修改不新增 item");
    assert.equal(after[0].id, before[0].id, "更新的是原 entry（同一 id）");
    assert.equal(after[0].displayName, "邱姓歷代祖先", "displayName 已更新");
    assert.equal(after[0].tabletAddress, "新地址9號", "tabletAddress 已更新");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 新增：【＋新增牌位】必須能建立第二張祖先牌位（不被 batch 的 ALREADY_EXISTS 攔截） ──
// 【＋新增牌位】走 POST .../entries → createUniversalSalvationEntry（與 registerItemsBatch 不同路徑，
// 無 ALREADY_EXISTS 判斷）；每張各自 1 Entry＋1 Item＋1 份應收；重新儲存不得增為 3 筆。乙位正魂同理。
dbTest("⑧ 【＋新增牌位】第二張祖先：1→2 items＋2 entries、各一份應收、重存不變 3", async () => {
  const { prisma, templeEvents, reg, ritual } = await load();
  const year = 9608;
  const hhId = hhIdFor(year);
  try {
    const { hh, m } = await setup(prisma, templeEvents, year, hhId);
    await seedWorship(prisma, hh.id, "ANCESTOR_LINE", "邱姓歷代祖先", "邱大", "祖先路1號");
    const keys = await usItemKeys(prisma);

    // 首次勾選：自動建立 1 筆 Draft。
    await reg.registerItemsBatch([{ memberId: m.id, registrationItemTypeId: keys["US_ANCESTOR"], year }], "測試");
    assert.equal((await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR").length, 1, "首次為 1 item");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "首次為 1 entry");

    // 使用者明確按【＋新增牌位】→ entries API（createUniversalSalvationEntry）。不得被攔截。
    const add = await ritual.createUniversalSalvationEntry(hh.id, year, { category: "ANCESTOR_LINE", displayName: "王姓歷代祖先", tabletAddress: "王路2號" }, "測試");
    assert.equal(add.ok, true, add.ok ? "" : `新增第二張失敗：${add.error}`);

    const items2 = (await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR");
    const entries2 = await entriesOf(prisma, year, "ANCESTOR_LINE");
    assert.equal(items2.length, 2, `【＋新增牌位】後應為 2 items，實得 ${items2.length}`);
    assert.equal(entries2.length, 2, `應為 2 entries，實得 ${entries2.length}`);
    // 各自 1:1、各自一份應收（各 2500）。
    const linkedIds = new Set(items2.map((i) => i.universalSalvationEntryId));
    assert.equal(linkedIds.size, 2, "兩筆 item 連結到不同 entry（各自 instance）");
    assert.ok(items2.every((i) => Number(i.amountDue) === TABLET_UNIT), "兩張各一份應收 2500");
    const names = new Set(items2.map((i) => i.universalSalvationEntry?.displayName));
    assert.deepEqual([...names].sort(), ["王姓歷代祖先", "邱姓歷代祖先"], "兩張為不同牌位");

    // 重新儲存其中一張 → 仍維持 2 筆，不得變 3。
    const upd = await ritual.updateUniversalSalvationEntry(hh.id, year, entries2[0].id, { tabletAddress: "改過的地址" }, "測試");
    assert.equal(upd.ok, true);
    assert.equal((await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR").length, 2, "重存後仍 2 items（不得增為 3）");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 2, "重存後仍 2 entries");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});

// ── 隔離自檢：setup／cleanup 可連續重跑兩次均通過（模擬 Ctrl+C 殘留，仍自動恢復不撞 409） ──
dbTest("⑨ setup/cleanup 連續重跑兩次均通過（殘留可自動恢復，不撞 409、不累積）", async () => {
  const { prisma, templeEvents, reg } = await load();
  const year = 9609;
  const hhId = hhIdFor(year);
  try {
    const keys0 = await usItemKeys(prisma);
    // 第一輪：setup（含 pre-clean）＋製造 record/entry/item 殘留，**故意不 cleanup**（模擬 Ctrl+C 中斷）。
    const r1 = await setup(prisma, templeEvents, year, hhId);
    const b1 = await reg.registerItemsBatch([{ memberId: r1.m.id, registrationItemTypeId: keys0["US_ANCESTOR"], year }], "測試");
    assert.equal(b1.ok, true, "第一輪建立報名成功");
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "第一輪 1 筆 entry");

    // 第二輪：直接再 setup（其 pre-clean 必須吃掉第一輪殘留）→ createTempleEvent 不得 409。
    // setup 內已 assert(ev.ok===true)；若殘留未清，這裡就會因 409 而失敗。
    const r2 = await setup(prisma, templeEvents, year, hhId);
    const b2 = await reg.registerItemsBatch([{ memberId: r2.m.id, registrationItemTypeId: keys0["US_ANCESTOR"], year }], "測試");
    assert.equal(b2.ok, true, "第二輪（殘留恢復後）建立報名成功");
    // 不累積：恢復後仍只有 1 筆（第一輪殘留已被清、非疊加）。
    assert.equal((await entriesOf(prisma, year, "ANCESTOR_LINE")).length, 1, "恢復後仍 1 筆 entry（未累積成 2）");
    assert.equal((await itemsOf(prisma, year)).filter((i) => i.registrationItemType.key === "US_ANCESTOR").length, 1, "恢復後仍 1 筆 item");
  } finally {
    await cleanup(prisma, year, hhId);
  }
});
