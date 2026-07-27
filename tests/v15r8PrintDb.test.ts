import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R8 普渡列印管理——DB regression（待 Mac）。
 *   RUN_DB_TESTS=1 DATABASE_URL="<測試庫>" npx tsx --test tests/v15r8PrintDb.test.ts
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const print = await import("../src/lib/printDocuments");
  return { prisma, print };
}
type P = Awaited<ReturnType<typeof load>>["prisma"];
const SUITE = "P8";

async function cleanup(prisma: P, years: number[], hhIds: string[]) {
  await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecord: { year: { in: years } } } } });
  await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecord: { year: { in: years } } } });
  await prisma.ritualRecord.deleteMany({ where: { year: { in: years } } });
  await prisma.member.deleteMany({ where: { householdId: { in: hhIds } } });
  await prisma.household.deleteMany({ where: { id: { in: hhIds } } });
}

/** 直接建立一筆「已確認」的祖先牌位（record+detail+entry+item），指定資料來源。 */
async function seedConfirmedAncestor(
  prisma: P,
  args: { hhId: string; hhName: string; year: number; source: string; displayName: string; yangshang: string[]; address: string; memberName?: string; status?: "CONFIRMED" | "DRAFT" }
) {
  await prisma.household.upsert({ where: { id: args.hhId }, create: { id: args.hhId, name: args.hhName, address: args.address }, update: {} });
  const member = args.memberName ? await prisma.member.create({ data: { householdId: args.hhId, name: args.memberName } }) : null;
  const itemType = await prisma.registrationItemType.findFirst({ where: { key: "US_ANCESTOR" }, select: { id: true } });
  const status = args.status ?? "CONFIRMED";
  const rec = await prisma.ritualRecord.upsert({
    where: { householdId_year_activityType: { householdId: args.hhId, year: args.year, activityType: "UNIVERSAL_SALVATION" } },
    create: { householdId: args.hhId, year: args.year, activityType: "UNIVERSAL_SALVATION", status, registrationSource: args.source, universalSalvation: { create: { isRegistered: true } } },
    update: { status, registrationSource: args.source },
    include: { universalSalvation: true },
  });
  const entry = await prisma.universalSalvationEntry.create({
    data: { universalSalvationId: rec.universalSalvation!.id, category: "ANCESTOR_LINE", displayName: args.displayName, yangshangNames: args.yangshang, tabletAddress: args.address, sortOrder: 1 },
  });
  const item = await prisma.ritualRegistrationItem.create({
    data: { ritualRecordId: rec.id, registrationItemTypeId: itemType!.id, memberId: member?.id ?? null, quantity: 1, amountDue: 2500, amountPaid: 0, amountUnpaid: 2500, status, universalSalvationEntryId: entry.id },
  });
  return { recordId: rec.id, itemId: item.id };
}

// A：列印語意——printCount++、首印一次、lastPrintedAt/操作人更新、金額/狀態不變、不增筆。
dbTest("A 列印/補印語意 + 財務隔離 + 不重複建立", async () => {
  const { prisma, print } = await load();
  const year = 8801; const hhId = `${SUITE}01`;
  try {
    await cleanup(prisma, [year], [hhId]);
    const { itemId } = await seedConfirmedAncestor(prisma, { hhId, hhName: "測試戶", year, source: "DEVOTEE_PAGE", displayName: "陳姓歷代祖先", yangshang: ["陳大"], address: "陳路1號" });

    const before = await print.listPrintCenterItems({ year });
    assert.equal(before.length, 1, "列出 1 筆");
    assert.equal(before[0].printCount, 0, "未列印");
    assert.equal(before[0].tabletName, "陳姓歷代祖先");
    assert.deepEqual(before[0].yangshangNames, ["陳大"]);
    assert.equal(before[0].tabletAddress, "陳路1號");
    assert.equal(before[0].sourceLabel, "信眾頁報名");

    // 首次列印
    const r1 = await print.printRegistrationItems([itemId], { id: "u1", name: "操作人甲" });
    assert.equal(r1.ok && r1.printed, 1);
    const i1 = await prisma.ritualRegistrationItem.findUnique({ where: { id: itemId } });
    const e1 = i1 as unknown as { printCount: number; printedAt: Date | null; lastPrintedAt: Date | null; printedByName: string | null };
    assert.equal(e1.printCount, 1, "首印 printCount=1");
    assert.ok(e1.printedAt, "printedAt 已設");
    assert.ok(e1.lastPrintedAt, "lastPrintedAt 已設");
    assert.equal(e1.printedByName, "操作人甲");
    assert.equal(Number(i1!.amountDue), 2500, "金額不變");
    assert.equal(Number(i1!.amountPaid), 0, "已收不變");
    assert.equal(i1!.status, "CONFIRMED", "狀態不變");
    const firstPrintedAt = e1.printedAt!.getTime();

    await new Promise((r) => setTimeout(r, 5));
    // 補印
    const r2 = await print.printRegistrationItems([itemId], { id: "u2", name: "操作人乙" });
    assert.equal(r2.ok && r2.printed, 1);
    const i2 = await prisma.ritualRegistrationItem.findUnique({ where: { id: itemId } });
    const e2 = i2 as unknown as { printCount: number; printedAt: Date | null; lastPrintedAt: Date | null; printedByName: string | null };
    assert.equal(e2.printCount, 2, "補印 printCount=2");
    assert.equal(e2.printedAt!.getTime(), firstPrintedAt, "printedAt 首次後不變");
    assert.ok(e2.lastPrintedAt!.getTime() >= firstPrintedAt, "lastPrintedAt 更新");
    assert.equal(e2.printedByName, "操作人乙", "操作人更新為最後執行者");

    // 不增第二筆 item / entry
    assert.equal(await prisma.ritualRegistrationItem.count({ where: { ritualRecord: { year } } }), 1, "不重複建立 item");
    assert.equal(await prisma.universalSalvationEntry.count({ where: { universalSalvation: { ritualRecord: { year } } } }), 1, "不重複建立 entry");
  } finally {
    await cleanup(prisma, [year], [hhId]);
  }
});

// B：所有來源同一中心 + 來源篩選 + 只列 CONFIRMED。
dbTest("B 五來源同一中心、來源篩選、只列 CONFIRMED（草稿不列）", async () => {
  const { prisma, print } = await load();
  const year = 8802; const hhA = `${SUITE}02A`; const hhB = `${SUITE}02B`; const hhC = `${SUITE}02C`;
  try {
    await cleanup(prisma, [year], [hhA, hhB, hhC]);
    await seedConfirmedAncestor(prisma, { hhId: hhA, hhName: "甲戶", year, source: "EXCEL_IMPORT", displayName: "王姓歷代祖先", yangshang: ["王大"], address: "王路1號" });
    await seedConfirmedAncestor(prisma, { hhId: hhB, hhName: "乙戶", year, source: "CARRY_OVER", displayName: "李姓歷代祖先", yangshang: ["李大"], address: "李路1號" });
    await seedConfirmedAncestor(prisma, { hhId: hhC, hhName: "丙戶", year, source: "DEVOTEE_PAGE", displayName: "林姓歷代祖先", yangshang: ["林大"], address: "林路1號", status: "DRAFT" }); // 草稿

    const all = await print.listPrintCenterItems({ year });
    assert.equal(all.length, 2, "只列兩筆 CONFIRMED（草稿不列）");
    assert.deepEqual([...new Set(all.map((r) => r.source))].sort(), ["CARRY_OVER", "EXCEL_IMPORT"]);

    const onlyImport = await print.listPrintCenterItems({ year, source: "EXCEL_IMPORT" });
    assert.equal(onlyImport.length, 1);
    assert.equal(onlyImport[0].sourceLabel, "Excel 匯入");

    // 搜尋：陽上人
    const byYang = await print.listPrintCenterItems({ year, q: "王大" });
    assert.equal(byYang.length, 1);
    assert.equal(byYang[0].tabletName, "王姓歷代祖先");
  } finally {
    await cleanup(prisma, [year], [hhA, hhB, hhC]);
  }
});

// C：全部列印只套目前篩選（不誤印其他來源）。
dbTest("C 全部列印只套目前篩選（依 filter 解析 id）", async () => {
  const { prisma, print } = await load();
  const year = 8803; const hhA = `${SUITE}03A`; const hhB = `${SUITE}03B`;
  try {
    await cleanup(prisma, [year], [hhA, hhB]);
    const a = await seedConfirmedAncestor(prisma, { hhId: hhA, hhName: "甲戶", year, source: "EXCEL_IMPORT", displayName: "吳姓歷代祖先", yangshang: ["吳大"], address: "吳路1號" });
    const b = await seedConfirmedAncestor(prisma, { hhId: hhB, hhName: "乙戶", year, source: "DEVOTEE_PAGE", displayName: "鄭姓歷代祖先", yangshang: ["鄭大"], address: "鄭路1號" });

    // 只列印 EXCEL_IMPORT 來源
    const ids = await print.resolvePrintableItemIds({ year, source: "EXCEL_IMPORT" });
    assert.deepEqual(ids, [a.itemId], "只解析出匯入來源那筆");
    await print.printRegistrationItems(ids, { id: "u1", name: "操作人" });

    const ia = (await prisma.ritualRegistrationItem.findUnique({ where: { id: a.itemId } })) as unknown as { printCount: number };
    const ib = (await prisma.ritualRegistrationItem.findUnique({ where: { id: b.itemId } })) as unknown as { printCount: number };
    assert.equal(ia.printCount, 1, "匯入來源已列印");
    assert.equal(ib.printCount, 0, "其他來源未被誤印");
  } finally {
    await cleanup(prisma, [year], [hhA, hhB]);
  }
});
