import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V27.4 「取消後重新報名」狀態恢復 整合回歸（需真實 DB，待 Mac）：
 *  - ensureLinkedTabletItem（重新報名機制）：CANCELLED+軟刪／CANCELLED未軟刪 item →
 *    恢復同一筆為 DRAFT、deletedAt=null，不新增重複；有效 DRAFT 再點不動。
 *  - reactivateTabletItemForReRegistration（限單筆修復）：dry-run 預覽、commit 僅改
 *    status/deletedAt/deletedByName；金額/付款/列印不變；多筆歷史 item 拒絕。
 *  - 祖先／乙位正魂／冤親三類皆適用。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v274ReactivateCancelledItemDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const reg = await import("../src/lib/registrationItemRegistration");
  const seed = await import("../src/lib/registrationItems");
  const backfill = await import("../src/lib/tabletItemBackfill");
  return { prisma, reg, seed, backfill };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T274A";
const YEAR = 191;

async function cleanup(l: Loaded) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" }, select: { id: true } });
  if (rr) {
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rr.id } }).catch(() => {});
    const usd = await prisma.universalSalvationDetail.findUnique({ where: { ritualRecordId: rr.id }, select: { id: true } });
    if (usd) {
      await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvationId: usd.id } }).catch(() => {});
      await prisma.universalSalvationDetail.delete({ where: { id: usd.id } }).catch(() => {});
    }
    await prisma.ritualRecord.delete({ where: { id: rr.id } }).catch(() => {});
  }
  await prisma.household.deleteMany({ where: { id: HH } }).catch(() => {});
}

async function setup(l: Loaded, recordStatus: "DRAFT" | "CONFIRMED" = "DRAFT") {
  const { prisma, seed } = l;
  await cleanup(l);
  await seed.ensureRegistrationItemTypesSeeded();
  await prisma.household.create({ data: { id: HH, name: "V274測試戶" } });
  const rr = await prisma.ritualRecord.create({ data: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION", status: recordStatus } });
  const usd = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
  return { rrId: rr.id, usdId: usd.id };
}

const makeEntry = (l: Loaded, usdId: string, category: string, displayName: string) =>
  l.prisma.universalSalvationEntry.create({ data: { universalSalvationId: usdId, category: category as never, displayName } });
const itemFor = (l: Loaded, entryId: string) =>
  l.prisma.ritualRegistrationItem.findUnique({ where: { universalSalvationEntryId: entryId } });

const CASES: { category: string; name: string }[] = [
  { category: "ANCESTOR_LINE", name: "周姓歷代祖先" },
  { category: "INDIVIDUAL_SOUL", name: "周能通 乙位正魂" },
  { category: "DEBT_CREDITOR", name: "累世冤親債主" },
];

dbTest("ensureLinkedTabletItem：CANCELLED+軟刪 → 恢復 DRAFT、不重複、金額/列印不變（三類）", async () => {
  const l = await load();
  const { prisma, reg } = l;
  for (const c of CASES) {
    try {
      const { rrId, usdId } = await setup(l);
      const e = await makeEntry(l, usdId, c.category, c.name);
      await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: c.category, year: YEAR, status: "DRAFT", memberId: null }));
      const it = await itemFor(l, e.id);
      await prisma.ritualRegistrationItem.update({ where: { id: it!.id }, data: { status: "CANCELLED", deletedAt: new Date(), deletedByName: "取消", amountDue: 300, amountPaid: 0, printCount: 1, printedAt: new Date("2024-08-01") } });

      // 使用者重新報名：ensureLinkedTabletItem 恢復同一筆（不因唯一鍵靜默 return）。
      await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: c.category, year: YEAR, status: "DRAFT", memberId: null }));
      const after = await itemFor(l, e.id);
      assert.equal(after?.status, "DRAFT", `${c.category} 恢復為 DRAFT`);
      assert.equal(after?.deletedAt, null, `${c.category} deletedAt 清空`);
      assert.equal(after?.deletedByName, null);
      assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: e.id } }), 1, "不新增重複");
      assert.equal(Number(after?.amountDue), 300, "金額不變");
      assert.equal(after?.printCount, 1, "列印次數不變");
      assert.equal(after?.printedAt?.getTime(), new Date("2024-08-01").getTime(), "列印時間不變");
    } finally {
      await cleanup(l).catch(() => {});
    }
  }
});

dbTest("ensureLinkedTabletItem：CANCELLED 未軟刪 → 也恢復 DRAFT；有效 DRAFT 再點不動", async () => {
  const l = await load();
  const { prisma, reg } = l;
  try {
    const { rrId, usdId } = await setup(l);
    const e = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先");
    await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null }));
    const it = await itemFor(l, e.id);
    await prisma.ritualRegistrationItem.update({ where: { id: it!.id }, data: { status: "CANCELLED" } }); // 取消但未軟刪
    await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null }));
    assert.equal((await itemFor(l, e.id))?.status, "DRAFT", "CANCELLED 未軟刪也恢復 DRAFT");

    // 有效 DRAFT 再點：不動、不重複。
    await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null }));
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { universalSalvationEntryId: e.id } }), 1);
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("reactivateTabletItemForReRegistration：dry-run 預覽、commit 僅改三欄、金額/列印不變、多筆拒絕", async () => {
  const l = await load();
  const { prisma, reg, backfill } = l;
  try {
    const { rrId, usdId } = await setup(l, "CONFIRMED"); // 即使 record 已 CONFIRMED，item 也恢復 DRAFT
    const e = await makeEntry(l, usdId, "ANCESTOR_LINE", "周姓歷代祖先");
    await prisma.$transaction((tx) => reg.ensureLinkedTabletItem(tx, { ritualRecordId: rrId, entryId: e.id, category: "ANCESTOR_LINE", year: YEAR, status: "DRAFT", memberId: null }));
    const it = await itemFor(l, e.id);
    await prisma.ritualRegistrationItem.update({ where: { id: it!.id }, data: { status: "CANCELLED", deletedAt: new Date(), deletedByName: "取消", amountDue: 300, amountPaid: 0, printCount: 2, printedAt: new Date("2024-08-01") } });
    const before = await itemFor(l, e.id);

    // dry-run：不寫入。
    const dry = await backfill.reactivateTabletItemForReRegistration(e.id, { commit: false });
    assert.equal(dry.ok && dry.action, "REACTIVATE");
    assert.equal(dry.ok === true && dry.committed, false);
    assert.notEqual((await itemFor(l, e.id))?.deletedAt, null, "dry-run 未動");

    // commit：只改三欄。
    const res = await backfill.reactivateTabletItemForReRegistration(e.id, { commit: true });
    assert.equal(res.ok && res.action, "REACTIVATE");
    const after = await itemFor(l, e.id);
    assert.equal(after?.status, "DRAFT");
    assert.equal(after?.deletedAt, null);
    assert.equal(after?.deletedByName, null);
    assert.equal(Number(after?.amountDue), 300, "金額不變");
    assert.equal(after?.printCount, 2, "列印不變");
    assert.equal(after?.printedAt?.getTime(), before?.printedAt?.getTime());
    assert.equal(after?.registrationItemTypeId, before?.registrationItemTypeId);
    assert.equal(after?.ritualRecordId, before?.ritualRecordId);
    assert.equal(after?.createdAt?.getTime(), before?.createdAt?.getTime());
    // record 未被本修復改動（限單筆 item）。
    assert.equal((await prisma.ritualRecord.findUnique({ where: { id: rrId } }))?.status, "CONFIRMED");

    // 已是有效 → ALREADY_ACTIVE。
    const again = await backfill.reactivateTabletItemForReRegistration(e.id, { commit: true });
    assert.equal(again.ok && again.action, "ALREADY_ACTIVE");

    // 不存在的 entry → 拒絕。
    const none = await backfill.reactivateTabletItemForReRegistration("nope-entry-id", { commit: false });
    assert.equal(none.ok, false);
  } finally {
    await cleanup(l).catch(() => {});
  }
});
