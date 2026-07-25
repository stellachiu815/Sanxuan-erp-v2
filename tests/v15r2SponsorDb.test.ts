import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R2 收斂修正 — DB 級整合測試（待 Mac）。
 *
 * ⚠️ 執行方式：這些測試需要**真實測試資料庫**，預設**跳過**（沙盒 Prisma 引擎為
 * darwin/linux 不符，且不應動到正式資料）。在 Mac／staging 對測試庫執行：
 *
 *     RUN_DB_TESTS=1 DATABASE_URL=<測試庫> npx tsx --test tests/v15r2SponsorDb.test.ts
 *
 * 為避免預設執行時觸發 Prisma 連線／引擎初始化，prisma 與 service 一律在測試內
 * **動態 import**；未設 RUN_DB_TESTS 時整個檔案的測試都標記 skip，不寫入任何資料。
 *
 * 涵蓋（實際查詢的資料表／欄位）：
 *   RitualRegistrationItem（id, registrationItemTypeId→key, status, quantity,
 *     lockedUnitPrice, amountDue, amountUnpaid, customName, deletedAt）
 *   UniversalSalvationDetail（isSponsor, amountDue, amountPaid, amountUnpaid, sponsorAmount）
 *   RitualRecord（status）
 *   收款：getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR" / "UNIVERSAL_SALVATION_SPONSOR_ITEM").listPending
 */

const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

// 動態載入，避免預設執行時初始化 Prisma。
async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const reg = await import("../src/lib/registrationItemRegistration");
  const ritual = await import("../src/lib/ritual");
  const adapters = await import("../src/lib/receivableAdapters");
  return { prisma, reg, ritual, adapters };
}

/** 建立一筆乾淨的測試家戶＋成員＋普渡 RitualRecord（CONFIRMED）＋Detail。回傳 ids 與清理函式。 */
async function seed(prisma: Awaited<ReturnType<typeof load>>["prisma"]) {
  const suffix = `v15r2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  // Household.id 為家戶編號（VarChar(10)、無預設值），測試自帶短唯一 id。
  const hhId = `T${Math.random().toString(36).slice(2, 9)}`.slice(0, 10);
  const household = await prisma.household.create({ data: { id: hhId, name: `測試家戶-${suffix}`, address: "測試地址1號" } });
  const member = await prisma.member.create({ data: { householdId: household.id, name: `測試本人-${suffix}`, isPrimaryContact: true } });
  const record = await prisma.ritualRecord.create({
    data: { householdId: household.id, year: 999, activityType: "UNIVERSAL_SALVATION", status: "CONFIRMED", registrationSource: "DEVOTEE_PAGE" },
  });
  const detail = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: record.id, isRegistered: true } });
  const cleanup = async () => {
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: record.id } });
    await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecordId: record.id } });
    await prisma.ritualRecord.deleteMany({ where: { id: record.id } });
    await prisma.member.deleteMany({ where: { householdId: household.id } });
    await prisma.household.deleteMany({ where: { id: household.id } });
    await prisma.templeEvent.deleteMany({ where: { activityType: "UNIVERSAL_SALVATION", year: 999 } });
  };
  return { householdId: household.id, memberId: member.id, recordId: record.id, detailId: detail.id, cleanup };
}

async function typeId(prisma: Awaited<ReturnType<typeof load>>["prisma"], key: string) {
  const t = await prisma.registrationItemType.findUnique({ where: { key }, select: { id: true } });
  assert.ok(t, `找不到 RegistrationItemType key=${key}（請先 seed 種子項目）`);
  return t!.id;
}

/** 設定該測試年度（999）一般贊普固定單價（TempleEvent.sponsorUnitPrice）；null＝未設定。 */
async function setYearSponsorPrice(prisma: Awaited<ReturnType<typeof load>>["prisma"], price: number | null) {
  await prisma.templeEvent.upsert({
    where: { activityType_year: { activityType: "UNIVERSAL_SALVATION", year: 999 } },
    create: { activityType: "UNIVERSAL_SALVATION", year: 999, name: "測試普渡999", sponsorUnitPrice: price },
    update: { sponsorUnitPrice: price },
  });
}

// ── A. 純讀取：listRegisteredItems 執行前後 DB 完全不變 ──────────────

dbTest("A1. 舊 Detail 贊普（無 item）→ listRegisteredItems 純讀取、DB 完全不變、且顯示唯讀相容列", async () => {
  const { prisma, reg } = await load();
  const s = await seed(prisma);
  try {
    // 只有舊 Detail 贊普、沒有任何 RitualRegistrationItem。
    await prisma.universalSalvationDetail.update({
      where: { id: s.detailId },
      data: { isSponsor: true, sponsorQuantity: 2, sponsorUnitPrice: 800, sponsorAmount: 1600, amountDue: 1600, amountUnpaid: 1600 },
    });

    const beforeItems = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: s.recordId } });
    const beforeDetail = await prisma.universalSalvationDetail.findUnique({ where: { id: s.detailId } });

    const views = await reg.listRegisteredItems(s.recordId);

    const afterItems = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: s.recordId } });
    const afterDetail = await prisma.universalSalvationDetail.findUnique({ where: { id: s.detailId } });

    assert.equal(afterItems, beforeItems, "listRegisteredItems 不得新增/刪除 RitualRegistrationItem");
    assert.deepEqual(afterDetail, beforeDetail, "listRegisteredItems 不得修改 UniversalSalvationDetail 任何欄位");
    // 舊資料仍以唯讀相容列顯示。
    const legacy = views.find((v) => v.readOnlyLegacy);
    assert.ok(legacy, "舊 Detail 贊普需以唯讀相容列顯示");
    assert.equal(legacy!.contentKind, "SPONSOR");
  } finally {
    await s.cleanup();
  }
});

dbTest("A2. READONLY GET /items 應 200 且不寫入任何資料（呼叫前後筆數/欄位一致）", async () => {
  const { prisma } = await load();
  const s = await seed(prisma);
  try {
    await prisma.universalSalvationDetail.update({ where: { id: s.detailId }, data: { isSponsor: true, sponsorQuantity: 1, sponsorUnitPrice: 500, sponsorAmount: 500, amountDue: 500, amountUnpaid: 500 } });
    const before = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: s.recordId } });

    // 直接呼叫實際 GET route handler，帶 READONLY operator（需測試庫有一位 READONLY 使用者；
    // 這裡以 requestOperator 的 header 方式帶入，實際 loginId 由測試環境提供）。
    const { GET } = await import("../src/app/api/registrations/[ritualRecordId]/items/route");
    const url = `http://localhost/api/registrations/${s.recordId}/items?operatorUserId=${process.env.READONLY_OPERATOR_USER_ID ?? ""}`;
    const req = new Request(url) as unknown as import("next/server").NextRequest;
    const res = await GET(req, { params: Promise.resolve({ ritualRecordId: s.recordId }) });
    assert.equal(res.status, 200, "READONLY 正常 GET 應為 200（非 403）");

    const after = await prisma.ritualRegistrationItem.count({ where: { ritualRecordId: s.recordId } });
    assert.equal(after, before, "READONLY GET 不得補建 item");
  } finally {
    await s.cleanup();
  }
});

// ── B. 贊普與隨喜贊普各自獨立建立、可同時存在、獨立取消 ──────────────

dbTest("B1. 儲存贊普→建立獨立 US_SPONSOR item（依年度固定價）；重複儲存不新增重複", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 800); // 年度固定價 800
    const key = await typeId(prisma, "US_SPONSOR");
    // 前端惡意送 sponsorUnitPrice=1 也不採用，後端用年度固定價 800。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorQuantity: 2, sponsorUnitPrice: 1 }, "測試");
    let items = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: key, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(items.length, 1);
    assert.equal(Number(items[0].lockedUnitPrice), 800, "鎖定單價＝年度固定價，非前端 1");
    assert.equal(Number(items[0].amountDue), 1600, "amountDue = 2 × 800");
    // 重複儲存（改數量 3）→ 仍是同一筆、沿用鎖定價 800 重算，不新增。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorQuantity: 3, sponsorUnitPrice: 1 }, "測試");
    items = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: key, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(items.length, 1, "重複儲存不得新增重複 item");
    assert.equal(Number(items[0].amountDue), 2400);
  } finally {
    await s.cleanup();
  }
});

dbTest("P1. 前端惡意 sponsorUnitPrice=1，DB 仍保存年度固定價 1500；數量 2 → amountDue 3000", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1500);
    const key = await typeId(prisma, "US_SPONSOR");
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 2, sponsorUnitPrice: 1 }, "測試");
    const it = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: key, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(Number(it!.lockedUnitPrice), 1500);
    assert.equal(Number(it!.amountDue), 3000);
  } finally {
    await s.cleanup();
  }
});

dbTest("P2. 年度固定價未設定 → 後端回傳明確錯誤（不默默用 0 或前端價）", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, null); // 未設定
    const r = await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 1, sponsorUnitPrice: 999 }, "測試");
    assert.equal(r.ok, false, "未設定固定價時不得成功建立");
    if (!r.ok) assert.match(r.error, /固定單價/);
    const key = await typeId(prisma, "US_SPONSOR");
    const items = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: key, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(items.length, 0, "不得建立任何贊普 item");
  } finally {
    await s.cleanup();
  }
});

dbTest("P3. lockedUnitPrice 保存報名當下價格快照；年度價之後變動不影響既有一般贊普", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1500);
    const key = await typeId(prisma, "US_SPONSOR");
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 2 }, "測試");
    // 年度價改成 2000。
    await setYearSponsorPrice(prisma, 2000);
    // 只改姓名，不得用新年度價覆蓋。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王大明", sponsorQuantity: 2 }, "測試");
    const it = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: key, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(Number(it!.lockedUnitPrice), 1500, "沿用原鎖定價快照，不被新年度價覆蓋");
    assert.equal(Number(it!.amountDue), 3000);
    assert.equal(it!.customName, "王大明");
  } finally {
    await s.cleanup();
  }
});

dbTest("P4. 隨喜贊普自由金額 5000／10000，不讀年度固定價；改一般贊普不影響隨喜贊普", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1500);
    const donationKey = await typeId(prisma, "US_SPONSOR_DONATION");
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isDonation: true, donationName: "啟華重工", donationAmount: 5000 }, "測試");
    let dn = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(Number(dn!.amountDue), 5000);
    assert.equal(dn!.quantity, 1);
    assert.equal(Number(dn!.lockedUnitPrice), 5000, "隨喜贊普 lockedUnitPrice＝自由金額，非年度固定價");
    // 改成 10000。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isDonation: true, donationName: "啟華重工", donationAmount: 10000 }, "測試");
    dn = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(Number(dn!.amountDue), 10000);
    // 建立一般贊普不影響隨喜贊普金額。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 3 }, "測試");
    dn = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(Number(dn!.amountDue), 10000, "隨喜贊普金額不受一般贊普影響");
  } finally {
    await s.cleanup();
  }
});

dbTest("B2. 贊普(王小明/2/1500/3000)與隨喜贊普(啟華重工/1/5000/5000) 完全獨立、customName 不同", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1500); // 一般贊普年度固定價 1500
    await ritual.updateUniversalSalvationDetail(
      s.householdId, 999,
      { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 2, sponsorUnitPrice: 1, isDonation: true, donationName: "啟華重工", donationAmount: 5000 },
      "測試"
    );
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    const donationKey = await typeId(prisma, "US_SPONSOR_DONATION");
    const sponsor = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, deletedAt: null, status: { not: "CANCELLED" } } });
    const donation = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.ok(sponsor && donation, "兩筆 sponsor item 需同時存在");
    assert.notEqual(sponsor!.id, donation!.id, "ID 不同");
    assert.notEqual(sponsor!.registrationItemTypeId, donation!.registrationItemTypeId, "itemType 不同");
    // customName 各自實際姓名、不同、且都不是「本人」。
    assert.equal(sponsor!.customName, "王小明");
    assert.equal(donation!.customName, "啟華重工");
    assert.notEqual(sponsor!.customName, donation!.customName);
    assert.notEqual(sponsor!.customName, "本人");
    // 數量／單價／金額各自獨立。
    assert.equal(sponsor!.quantity, 2);
    assert.equal(donation!.quantity, 1);
    assert.equal(Number(sponsor!.lockedUnitPrice), 1500);
    assert.equal(Number(donation!.lockedUnitPrice), 5000);
    assert.equal(Number(sponsor!.amountDue), 3000);
    assert.equal(Number(donation!.amountDue), 5000);
  } finally {
    await s.cleanup();
  }
});

dbTest("B2b. 編輯贊普姓名不改隨喜贊普姓名；反之亦然；重新儲存不新增第三筆", async () => {
  const { prisma, ritual } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1500);
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    const donationKey = await typeId(prisma, "US_SPONSOR_DONATION");
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 2, sponsorUnitPrice: 1500, isDonation: true, donationName: "啟華重工", donationAmount: 5000 }, "測試");
    // 只改贊普姓名。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王大明", sponsorQuantity: 2, sponsorUnitPrice: 1500 }, "測試");
    const sp = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, deletedAt: null, status: { not: "CANCELLED" } } });
    const dn = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(sp.length, 1, "贊普仍為單筆（不新增第三筆）");
    assert.equal(dn.length, 1, "隨喜贊普仍為單筆");
    assert.equal(sp[0].customName, "王大明", "贊普姓名已更新");
    assert.equal(dn[0].customName, "啟華重工", "隨喜贊普姓名未受影響");
  } finally {
    await s.cleanup();
  }
});

dbTest("B4. 舊資料 customName='本人' → 讀取相容顯示 member 實名（不寫入）；下一次儲存寫入實際姓名", async () => {
  const { prisma, ritual, reg } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1000);
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    // 模擬舊資料：US_SPONSOR item 的 customName 存「本人」。
    const legacy = await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, memberId: s.memberId, quantity: 1, customName: "本人", lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "CONFIRMED" } });
    const before = await prisma.ritualRegistrationItem.findUnique({ where: { id: legacy.id } });
    const views = await reg.listRegisteredItems(s.recordId);
    const after = await prisma.ritualRegistrationItem.findUnique({ where: { id: legacy.id } });
    assert.deepEqual(after, before, "讀取不得改寫舊 customName");
    const spView = views.find((v) => v.itemKey === "US_SPONSOR");
    assert.ok(spView);
    assert.notEqual(spView!.subjectName, "本人", "顯示不得為「本人」");
    assert.equal(spView!.subjectName.startsWith("測試本人-"), true, "以 member 實名相容顯示");
    // 下一次合法儲存 → 寫入實際姓名。
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 1, sponsorUnitPrice: 1000 }, "測試");
    const saved = await prisma.ritualRegistrationItem.findUnique({ where: { id: legacy.id } });
    assert.equal(saved!.customName, "王小明", "下一次儲存把實際姓名寫入正式 item");
  } finally {
    await s.cleanup();
  }
});

dbTest("B5. 找不到實名（無 member、customName 空）→ 顯示「姓名待補」，非「本人」", async () => {
  const { prisma, reg } = await load();
  const s = await seed(prisma);
  try {
    // 移除成員、建立 customName=null 的 US_SPONSOR。
    await prisma.member.deleteMany({ where: { householdId: s.householdId } });
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, quantity: 1, customName: null, lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "CONFIRMED" } });
    const views = await reg.listRegisteredItems(s.recordId);
    const spView = views.find((v) => v.itemKey === "US_SPONSOR");
    assert.equal(spView!.subjectName, "姓名待補");
  } finally {
    await s.cleanup();
  }
});

dbTest("C4. 歷史多筆有效 US_SPONSOR（未收款）→ 合法儲存整理成單筆，應收只計一次", async () => {
  const { prisma, ritual, adapters } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 1000);
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    // 異常：兩筆有效未收款 US_SPONSOR。
    await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, quantity: 1, customName: "重複A", lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "CONFIRMED" } });
    await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, quantity: 1, customName: "重複B", lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "CONFIRMED" } });
    await ritual.updateUniversalSalvationDetail(s.householdId, 999, { isSponsor: true, sponsorName: "王小明", sponsorQuantity: 1, sponsorUnitPrice: 1000 }, "測試");
    const actives = await prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, deletedAt: null, status: { not: "CANCELLED" } } });
    assert.equal(actives.length, 1, "整理後只剩單筆有效贊普");
    const itemAdapter = adapters.getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR_ITEM")!;
    const pending = (await itemAdapter.listPending({ sponsorHouseholdId: s.householdId, currentYear: 999 })).filter((p) => p.householdId === s.householdId);
    assert.equal(pending.length, 1, "應收只計一次");
  } finally {
    await s.cleanup();
  }
});

dbTest("B3. 取消其中一項不影響另一項（狀態/金額/應收各自獨立）", async () => {
  const { prisma, ritual, reg } = await load();
  const s = await seed(prisma);
  try {
    await setYearSponsorPrice(prisma, 800);
    await ritual.updateUniversalSalvationDetail(
      s.householdId, 999,
      { isSponsor: true, sponsorQuantity: 2, sponsorUnitPrice: 800, isDonation: true, donationName: "某某公司", donationAmount: 1200 },
      "測試"
    );
    const donationKey = await typeId(prisma, "US_SPONSOR_DONATION");
    const sponsorKey = await typeId(prisma, "US_SPONSOR");
    const donation = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: donationKey, deletedAt: null } });
    // 取消隨喜贊普。
    const r = await reg.removeRegisteredItem(donation!.id, "測試");
    assert.equal(r.ok, true);
    const donationAfter = await prisma.ritualRegistrationItem.findUnique({ where: { id: donation!.id } });
    const sponsorAfter = await prisma.ritualRegistrationItem.findFirst({ where: { ritualRecordId: s.recordId, registrationItemTypeId: sponsorKey, deletedAt: null } });
    assert.equal(donationAfter!.status, "CANCELLED");
    assert.equal(Number(donationAfter!.amountUnpaid), 0);
    assert.ok(sponsorAfter, "贊普不受影響、仍存在");
    assert.equal(Number(sponsorAfter!.amountDue), 1600, "贊普金額不變");
  } finally {
    await s.cleanup();
  }
});

// ── C. 應收不重複計價（舊 Detail adapter 主動排除已有正式 item） ──────

dbTest("C1. 舊 Detail 有值、無 item → 只計 Detail 一次", async () => {
  const { prisma, adapters } = await load();
  const s = await seed(prisma);
  try {
    await prisma.universalSalvationDetail.update({ where: { id: s.detailId }, data: { isSponsor: true, sponsorQuantity: 1, sponsorUnitPrice: 1000, sponsorAmount: 1000, amountDue: 1000, amountUnpaid: 1000 } });
    const detailAdapter = adapters.getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR")!;
    const pending = await detailAdapter.listPending({ sponsorHouseholdId: s.householdId, currentYear: 999 });
    const forThis = pending.filter((p) => p.householdId === s.householdId);
    assert.equal(forThis.length, 1, "無 item 時舊 Detail 應計一次");
    assert.equal(forThis.reduce((a, p) => a + p.unpaidAmount, 0), 1000);
  } finally {
    await s.cleanup();
  }
});

dbTest("C2. 舊 Detail 有值、同時有 CONFIRMED US_SPONSOR item（異常並存）→ 只計 item 一次、Detail 被排除", async () => {
  const { prisma, adapters } = await load();
  const s = await seed(prisma);
  try {
    const key = await typeId(prisma, "US_SPONSOR");
    // 異常並存：Detail.amountDue>0 且 item.amountDue>0（模擬舊版本/匯入殘留）。
    await prisma.universalSalvationDetail.update({ where: { id: s.detailId }, data: { isSponsor: true, sponsorQuantity: 1, sponsorUnitPrice: 1000, sponsorAmount: 1000, amountDue: 1000, amountUnpaid: 1000 } });
    await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: key, memberId: s.memberId, quantity: 1, customName: "本人", lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "CONFIRMED" } });

    const detailAdapter = adapters.getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR")!;
    const itemAdapter = adapters.getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR_ITEM")!;
    const detailPending = (await detailAdapter.listPending({ sponsorHouseholdId: s.householdId, currentYear: 999 })).filter((p) => p.householdId === s.householdId);
    const itemPending = (await itemAdapter.listPending({ sponsorHouseholdId: s.householdId, currentYear: 999 })).filter((p) => p.householdId === s.householdId);

    assert.equal(detailPending.length, 0, "已有 CONFIRMED US_SPONSOR item 時，舊 Detail adapter 必須直接排除、不產生應收");
    assert.equal(itemPending.length, 1, "只由正式 item adapter 計一次");
    assert.equal(itemPending[0].unpaidAmount, 1000);
  } finally {
    await s.cleanup();
  }
});

dbTest("C3. DRAFT US_SPONSOR item 不遮蔽舊 Detail（仍相容計價）", async () => {
  const { prisma, adapters } = await load();
  const s = await seed(prisma);
  try {
    const key = await typeId(prisma, "US_SPONSOR");
    await prisma.universalSalvationDetail.update({ where: { id: s.detailId }, data: { isSponsor: true, sponsorQuantity: 1, sponsorUnitPrice: 1000, sponsorAmount: 1000, amountDue: 1000, amountUnpaid: 1000 } });
    // DRAFT item 不應遮蔽（也不會被 item adapter 計，因 item adapter 只計 CONFIRMED）。
    await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: key, memberId: s.memberId, quantity: 1, lockedUnitPrice: 1000, amountDue: 1000, amountUnpaid: 1000, feeChoice: "FIXED", status: "DRAFT" } });
    const detailAdapter = adapters.getReceivableAdapter("UNIVERSAL_SALVATION_SPONSOR")!;
    const detailPending = (await detailAdapter.listPending({ sponsorHouseholdId: s.householdId, currentYear: 999 })).filter((p) => p.householdId === s.householdId);
    assert.equal(detailPending.length, 1, "只有 DRAFT item 時，舊 Detail 仍計一次（不被遮蔽）");
  } finally {
    await s.cleanup();
  }
});
