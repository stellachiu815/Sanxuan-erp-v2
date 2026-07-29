import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V28「家戶正式維護收尾」整合 regression（需真實 DB，待 Mac）：
 *   A. 祭祀資料 編輯 → 封存 → 恢復 全流程；封存/恢復稽核與封存區查詢正確。
 *   B. 有效查詢（getHouseholdDetail.worshipRecords）排除已封存牌位。
 *   C. 年度快照不回溯：封存 WorshipRecord 不動既有 UniversalSalvationEntry。
 *   D. 成員 封存 → 恢復；封存後保留 householdId（不產生孤兒），有效查詢排除。
 *   E. 移出成員：建立個人戶（moveMemberToNewPersonalHousehold）與移至既有家戶（transferHouseholdMembers）。
 *   F. 家戶封存前檢查：有在戶成員 → canArchive=false 且 archiveHousehold 阻擋；清空後可封存。
 *
 *   執行：
 *     RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v28HouseholdMaintenanceDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const worship = await import("../src/lib/worshipRecordManagement");
  const hh = await import("../src/lib/householdManagement");
  const detail = await import("../src/lib/household");
  return { prisma, worship, hh, detail };
}
type Loaded = Awaited<ReturnType<typeof load>>;

const HH = "T28A";
const HH_TARGET = "T28B";
const OP = "測試操作員";

async function cleanup(l: Loaded) {
  const { prisma } = l;
  // 清掉可能建立的個人戶（名稱前綴）與兩個測試家戶底下所有資料。
  const personal = await prisma.household.findMany({
    where: { name: { contains: "（個人戶）" }, members: { some: { name: "乙成員" } } },
    select: { id: true },
  });
  const codes = [HH, HH_TARGET, ...personal.map((h) => h.id)];
  for (const code of codes) {
    const rrs = await prisma.ritualRecord.findMany({ where: { householdId: code }, select: { id: true } });
    for (const rr of rrs) {
      const usd = await prisma.universalSalvationDetail.findUnique({ where: { ritualRecordId: rr.id }, select: { id: true } });
      if (usd) {
        await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvationId: usd.id } }).catch(() => {});
        await prisma.universalSalvationDetail.delete({ where: { id: usd.id } }).catch(() => {});
      }
      await prisma.ritualRecord.delete({ where: { id: rr.id } }).catch(() => {});
    }
    await prisma.worshipRecord.deleteMany({ where: { householdId: code } }).catch(() => {});
    await prisma.member.deleteMany({ where: { householdId: code } }).catch(() => {});
  }
  await prisma.household.deleteMany({ where: { id: { in: codes } } }).catch(() => {});
}

dbTest("A/B/C：祭祀編輯・封存・恢復、有效查詢排除、年度快照不回溯", async () => {
  const l = await load();
  const { prisma, worship, detail } = l;
  try {
    await cleanup(l);
    await prisma.household.create({ data: { id: HH, name: "V28測試家戶" } });
    const wr = await prisma.worshipRecord.create({
      data: { householdId: HH, type: "ANCESTOR_LINE", displayName: "王姓歷代祖先", yangshangName: "王大明", location: "本宮" },
    });

    // 建立既有年度普渡快照（entry 指向這筆 WorshipRecord），用來驗證封存不回溯。
    const rr = await prisma.ritualRecord.create({
      data: { householdId: HH, year: 199, activityType: "UNIVERSAL_SALVATION", status: "CONFIRMED" },
    });
    const usd = await prisma.universalSalvationDetail.create({ data: { ritualRecordId: rr.id, isRegistered: true } });
    const entry = await prisma.universalSalvationEntry.create({
      data: {
        universalSalvationId: usd.id,
        category: "ANCESTOR_LINE",
        displayName: "王姓歷代祖先",
        yangshangNames: ["王大明"],
        tabletAddress: "本宮",
        worshipRecordId: wr.id,
      },
    });

    // A1 編輯：只改陽上人與地址。
    const upd = await worship.updateWorshipRecord(wr.id, { yangshangName: "王大明、王小華", location: "祖先殿" }, OP);
    assert.equal(upd.ok, true);
    const after = await prisma.worshipRecord.findUniqueOrThrow({ where: { id: wr.id } });
    assert.equal(after.yangshangName, "王大明、王小華");
    assert.equal(after.location, "祖先殿");

    // A2 封存。
    const arch = await worship.archiveWorshipRecord(wr.id, OP);
    assert.equal(arch.ok, true);
    const archived = await prisma.worshipRecord.findUniqueOrThrow({ where: { id: wr.id } });
    assert.ok(archived.deletedAt, "封存後 deletedAt 有值");
    assert.equal(archived.deletedByName, OP);

    // B 有效查詢排除封存。
    const view = await detail.getHouseholdDetail(HH);
    assert.ok(view, "家戶存在");
    assert.equal(view!.worshipRecords.some((w) => w.id === wr.id), false, "有效查詢不含已封存牌位");

    // 封存區可查。
    const archList = await worship.listArchivedWorshipRecords(HH);
    assert.equal(archList.some((w) => w.id === wr.id), true, "封存區可查到");

    // C 年度快照不回溯：entry 完全不變。
    const entryAfter = await prisma.universalSalvationEntry.findUniqueOrThrow({ where: { id: entry.id } });
    assert.equal(entryAfter.deletedAt, null, "既有年度 entry 未被連帶封存");
    assert.deepEqual(entryAfter.yangshangNames, ["王大明"], "年度 entry 陽上人快照不被編輯回溯");
    assert.equal(entryAfter.displayName, "王姓歷代祖先");

    // A3 恢復。
    const res = await worship.restoreWorshipRecord(wr.id, OP);
    assert.equal(res.ok, true);
    const restored = await prisma.worshipRecord.findUniqueOrThrow({ where: { id: wr.id } });
    assert.equal(restored.deletedAt, null);
    const view2 = await detail.getHouseholdDetail(HH);
    assert.equal(view2!.worshipRecords.some((w) => w.id === wr.id), true, "恢復後重新出現在有效查詢");
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("D/E：成員封存/恢復（保留 householdId）、建立個人戶、移至既有家戶", async () => {
  const l = await load();
  const { prisma, hh, detail } = l;
  try {
    await cleanup(l);
    await prisma.household.create({ data: { id: HH, name: "V28成員戶" } });
    await prisma.household.create({ data: { id: HH_TARGET, name: "V28目標戶" } });
    const a = await prisma.member.create({ data: { householdId: HH, name: "甲成員", role: "HOUSEHOLD_HEAD" } });
    const b = await prisma.member.create({ data: { householdId: HH, name: "乙成員", role: "OTHER" } });

    // D 封存乙成員 → 保留 householdId、有效查詢排除。
    await hh.archiveMember(b.id, OP);
    const bArch = await prisma.member.findUniqueOrThrow({ where: { id: b.id } });
    assert.ok(bArch.deletedAt, "成員封存後 deletedAt 有值");
    assert.equal(bArch.householdId, HH, "封存後仍保留原 householdId（不產生孤兒）");
    const view = await detail.getHouseholdDetail(HH);
    assert.equal(view!.members.some((m) => m.id === b.id), false, "有效查詢排除已封存成員");

    // D2 恢復乙成員。
    await hh.restoreMember(b.id, OP);
    const bBack = await prisma.member.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(bBack.deletedAt, null);

    // E1 建立個人戶：把乙成員移出到新個人戶。
    const { household: personal } = await hh.moveMemberToNewPersonalHousehold({ memberId: b.id, operatorName: OP });
    const bMoved = await prisma.member.findUniqueOrThrow({ where: { id: b.id } });
    assert.equal(bMoved.householdId, personal.id, "乙成員已移入新個人戶");
    assert.notEqual(personal.id, HH);

    // E2 移至既有家戶：把甲成員移到 HH_TARGET（甲是原戶長且原戶已無其他在戶成員，不需新戶長）。
    await hh.transferHouseholdMembers({ memberIds: [a.id], targetHouseholdId: HH_TARGET, operatorName: OP });
    const aMoved = await prisma.member.findUniqueOrThrow({ where: { id: a.id } });
    assert.equal(aMoved.householdId, HH_TARGET, "甲成員已移至既有家戶");
  } finally {
    await cleanup(l).catch(() => {});
  }
});

dbTest("F：家戶封存前檢查——有在戶成員時阻擋，清空後可封存", async () => {
  const l = await load();
  const { prisma, hh } = l;
  try {
    await cleanup(l);
    await prisma.household.create({ data: { id: HH, name: "V28封存檢查戶" } });
    const m = await prisma.member.create({ data: { householdId: HH, name: "甲成員", role: "HOUSEHOLD_HEAD" } });

    const pre = await hh.previewHouseholdArchive(HH);
    assert.equal(pre.canArchive, false, "有在戶成員 → 不可封存");
    assert.equal(pre.activeMemberCount, 1);
    assert.ok(pre.blockers.length > 0);

    await assert.rejects(() => hh.archiveHousehold(HH, null, OP), /無法封存/, "有成員時 archiveHousehold 應丟出阻擋錯誤");

    // 封存成員後（保留 householdId 但非在戶），家戶即無在戶成員 → 可封存。
    await hh.archiveMember(m.id, OP);
    const pre2 = await hh.previewHouseholdArchive(HH);
    assert.equal(pre2.canArchive, true, "清空在戶成員後可封存");
    const { household } = await hh.archiveHousehold(HH, "測試封存", OP);
    assert.ok(household.deletedAt, "家戶已封存");
  } finally {
    await cleanup(l).catch(() => {});
  }
});
