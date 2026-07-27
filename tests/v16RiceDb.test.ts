import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V16 白米——DB regression（待 Mac / 真實 Postgres）。
 *   RUN_DB_TESTS=1 DATABASE_URL="<測試庫>" npx tsx --test tests/v16RiceDb.test.ts
 *
 * 驗證：年度配額只算 US_RICE + CONFIRMED + 未刪除；DRAFT 不佔額；確認時佔額並在同一 tx 檢查；
 * riceAllowOverbook=false 時所有角色一律不得超量；true 允許超量且剩餘可為負；
 * 改斤數用 lockedUnitPrice、增量佔額/減量釋放、溢收阻擋；取消釋放額度；不建第二套收款/交易。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const rice = await import("../src/lib/whiteRiceService");
  const act = await import("../src/lib/activityRegistration");
  return { prisma, rice, act };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];
const SUITE = "R16";

async function cleanup(prisma: P, years: number[], hhIds: string[]) {
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.ritualRecord.deleteMany({ where: { year: { in: years } } });
  await prisma.member.deleteMany({ where: { householdId: { in: hhIds } } });
  await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
  await prisma.templeEvent.deleteMany({ where: { year: { in: years }, activityType: "UNIVERSAL_SALVATION" } });
}

async function seedYear(prisma: P, year: number, opts: { totalKg: number; unitPrice: number; open: boolean; allowOverbook: boolean }) {
  return prisma.templeEvent.create({
    data: ({
      name: `測試普渡${year}`, activityType: "UNIVERSAL_SALVATION", year,
      riceTotalKg: opts.totalKg, riceUnitPrice: opts.unitPrice, riceOpen: opts.open, riceAllowOverbook: opts.allowOverbook,
    } as unknown as Record<string, unknown>) as never,
  });
}

async function seedRecord(prisma: P, hhId: string, hhName: string, year: number, templeEventId: string) {
  await prisma.household.upsert({ where: { id: hhId }, create: { id: hhId, name: hhName, address: "測試路1號" }, update: {} });
  const rec = await prisma.ritualRecord.upsert({
    where: { householdId_year_activityType: { householdId: hhId, year, activityType: "UNIVERSAL_SALVATION" } },
    create: { householdId: hhId, year, activityType: "UNIVERSAL_SALVATION", status: "DRAFT", templeEventId, universalSalvation: { create: { isRegistered: true } } },
    update: {},
  });
  return rec.id;
}

// 1) 年度配額只算 CONFIRMED；DRAFT 不佔額。
dbTest("1 配額只算 US_RICE+CONFIRMED；DRAFT 不佔額", async () => {
  const { prisma, rice } = await load();
  const year = 9601; const hh = `${SUITE}01`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 100, unitPrice: 10, open: true, allowOverbook: false });
    const recId = await seedRecord(prisma, hh, "甲戶", year, ev.id);
    // CONFIRMED 10 斤（registerRice 直接建 CONFIRMED）
    const r = await rice.registerRice({ ritualRecordId: recId, memberId: null, kg: 10, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" });
    assert.ok(r.ok);
    const before = await rice.getRiceQuotaSummary(ev.id);
    assert.equal(before?.registeredKg, 10);
    assert.equal(before?.remainingKg, 90);
    // 另建一筆 DRAFT 白米（不佔額）
    const type = await prisma.registrationItemType.findFirst({ where: { key: "US_RICE" }, select: { id: true } });
    await prisma.ritualRegistrationItem.create({ data: ({ ritualRecordId: recId, registrationItemTypeId: type!.id, quantity: 5, amountDue: 50, amountPaid: 0, amountUnpaid: 50, lockedUnitPrice: 10, status: "DRAFT" } as unknown as Record<string, unknown>) as never });
    const after = await rice.getRiceQuotaSummary(ev.id);
    assert.equal(after?.registeredKg, 10, "DRAFT 不佔額");
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 2) 未開放超量：所有角色一律不得超量（含 ADMIN/SUPER_ADMIN）。
dbTest("2 未開放超量→ADMIN 也被擋，錯誤含年度總量/剩餘/超出", async () => {
  const { prisma, rice } = await load();
  const year = 9602; const hh = `${SUITE}02`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 10, unitPrice: 10, open: true, allowOverbook: false });
    const recId = await seedRecord(prisma, hh, "乙戶", year, ev.id);
    const r = await rice.registerRice({ ritualRecordId: recId, memberId: null, kg: 15, overageReason: "急用" }, { role: "SUPER_ADMIN", userId: "u", name: "超管" });
    assert.equal(r.ok, false);
    if (!r.ok) { assert.equal(r.status, 403); assert.match(r.error, /剩餘|超出/); }
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 3) 開放超量：允許、剩餘可為負。
dbTest("3 開放超量→允許，剩餘為負、overbook=true", async () => {
  const { prisma, rice } = await load();
  const year = 9603; const hh = `${SUITE}03`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 10, unitPrice: 10, open: true, allowOverbook: true });
    const recId = await seedRecord(prisma, hh, "丙戶", year, ev.id);
    const r = await rice.registerRice({ ritualRecordId: recId, memberId: null, kg: 15, overageReason: null }, { role: "STAFF", userId: "u", name: "職員" });
    assert.ok(r.ok);
    const sum = await rice.getRiceQuotaSummary(ev.id);
    assert.equal(sum?.remainingKg, -5);
    assert.equal(sum?.isOverbooked, true);
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 4) 確認報名時 DRAFT 白米佔額並於同 tx 檢查（未開放超量→整批擋）。
dbTest("4 confirmRegistration：DRAFT 白米超量→未開放時擋，狀態不變", async () => {
  const { prisma, rice, act } = await load();
  const year = 9604; const hh = `${SUITE}04`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 10, unitPrice: 10, open: true, allowOverbook: false });
    const recId = await seedRecord(prisma, hh, "丁戶", year, ev.id);
    const type = await prisma.registrationItemType.findFirst({ where: { key: "US_RICE" }, select: { id: true } });
    await prisma.ritualRegistrationItem.create({ data: ({ ritualRecordId: recId, registrationItemTypeId: type!.id, quantity: 15, amountDue: 150, amountPaid: 0, amountUnpaid: 150, lockedUnitPrice: 10, status: "DRAFT" } as unknown as Record<string, unknown>) as never });
    const res = await act.confirmRegistration(recId, "管理員");
    assert.equal(res.ok, false);
    const rec = await prisma.ritualRecord.findUnique({ where: { id: recId }, select: { status: true } });
    assert.equal(rec?.status, "DRAFT", "被擋後狀態不變");
    void rice;
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 5) 改斤數：增量佔額、用 lockedUnitPrice 重算；減量釋放；溢收阻擋。
dbTest("5 updateRiceQuantity：lockedUnitPrice 重算、溢收阻擋、不動 amountPaid", async () => {
  const { prisma, rice } = await load();
  const year = 9605; const hh = `${SUITE}05`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 100, unitPrice: 10, open: true, allowOverbook: false });
    const recId = await seedRecord(prisma, hh, "戊戶", year, ev.id);
    const r = await rice.registerRice({ ritualRecordId: recId, memberId: null, kg: 10, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" });
    assert.ok(r.ok);
    const itemId = r.ok ? r.itemId : "";
    // 模擬已收 80 元
    await prisma.ritualRegistrationItem.update({ where: { id: itemId }, data: { amountPaid: 80, amountUnpaid: 70 } });
    // 減到 5 斤＝新應收 50 < 已收 80 → 溢收阻擋
    const over = await rice.updateRiceQuantity(itemId, 5, { name: "管理員" });
    assert.equal(over.ok, false);
    if (!over.ok) assert.match(over.error, /溢收|低於/);
    // 加到 12 斤＝新應收 120，未收 40，amountPaid 不變
    const up = await rice.updateRiceQuantity(itemId, 12, { name: "管理員" });
    assert.ok(up.ok);
    const item = await prisma.ritualRegistrationItem.findUnique({ where: { id: itemId } });
    assert.equal(Number(item!.amountDue), 120);
    assert.equal(Number(item!.amountPaid), 80, "amountPaid 不變");
    assert.equal(Number(item!.amountUnpaid), 40);
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 6) 取消/軟刪除釋放額度（不再計入配額）。
dbTest("6 取消白米→釋放額度", async () => {
  const { prisma, rice } = await load();
  const year = 9606; const hh = `${SUITE}06`;
  try {
    await cleanup(prisma, [year], [hh]);
    const ev = await seedYear(prisma, year, { totalKg: 100, unitPrice: 10, open: true, allowOverbook: false });
    const recId = await seedRecord(prisma, hh, "己戶", year, ev.id);
    const r = await rice.registerRice({ ritualRecordId: recId, memberId: null, kg: 30, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" });
    assert.ok(r.ok);
    const itemId = r.ok ? r.itemId : "";
    assert.equal((await rice.getRiceQuotaSummary(ev.id))?.registeredKg, 30);
    await prisma.ritualRegistrationItem.update({ where: { id: itemId }, data: { status: "CANCELLED" } });
    assert.equal((await rice.getRiceQuotaSummary(ev.id))?.registeredKg, 0, "取消後釋放");
  } finally { await cleanup(prisma, [year], [hh]); }
});

// 7) 跨家戶配額共用：兩戶認購合計佔同一年度總量。
dbTest("7 跨家戶配額共用，合計佔同一年度總量", async () => {
  const { prisma, rice } = await load();
  const year = 9607; const hhA = `${SUITE}07A`; const hhB = `${SUITE}07B`;
  try {
    await cleanup(prisma, [year], [hhA, hhB]);
    const ev = await seedYear(prisma, year, { totalKg: 50, unitPrice: 10, open: true, allowOverbook: false });
    const recA = await seedRecord(prisma, hhA, "庚戶", year, ev.id);
    const recB = await seedRecord(prisma, hhB, "辛戶", year, ev.id);
    assert.ok((await rice.registerRice({ ritualRecordId: recA, memberId: null, kg: 30, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" })).ok);
    // B 戶再認購 25 → 合計 55 > 50，未開放超量 → 擋
    const rb = await rice.registerRice({ ritualRecordId: recB, memberId: null, kg: 25, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" });
    assert.equal(rb.ok, false);
    // B 戶改認 20 → 合計 50 → 可
    assert.ok((await rice.registerRice({ ritualRecordId: recB, memberId: null, kg: 20, overageReason: null }, { role: "ADMIN", userId: "u", name: "管理員" })).ok);
    assert.equal((await rice.getRiceQuotaSummary(ev.id))?.remainingKg, 0);
  } finally { await cleanup(prisma, [year], [hhA, hhB]); }
});
