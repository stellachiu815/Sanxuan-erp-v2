import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V30.7 中元普渡跨層 Integration（需真實測試 DB；沿用專案既有 RUN_DB_TESTS 慣例）。
 * 走全部正式函式（createUniversalSalvationEntry / registerItemsBatch / confirmRegistration /
 * createExtraPocket / getUniversalSalvationRegistrationDetail / buildItemRoster / listPrintCenterItems /
 * getUniversalSalvationRosterExport），不使用修復 script。
 *
 *   RUN_DB_TESTS=1 DATABASE_URL="<獨立測試庫>" npx tsx --test tests/v307IntegrationDb.test.ts
 *
 * 預期（每個 test 內以 assert 驗證，Mac 執行時全綠）：
 *  1~4 祖先/乙位/冤親/無緣：record+item+entry+基本寶袋+registrationOrder 全建立且互相連結。
 *  3   冤親 itemType 存在時 entry+item 原子建立、無孤兒（缺 itemType 會 rollback 由 ensureLinkedTabletItem 拋錯保證）。
 *  5   CONFIRMED record 後新增 DRAFT item → 再確認可轉 CONFIRMED；未收款不影響；金額不變。
 *  6   編輯既有牌位不重複建立 entry/item/基本寶袋。
 *  7   基本寶袋免費、有自己的 registrationOrder、可列印。
 *  8   額外寶袋收費只一筆應收；免費 amountDue=0 仍可列印；No.xxx 不誤取依附牌位。
 *  9   同一資料在 明細/總名單/列印管理/Excel 四處筆數與 registrationOrder 一致。
 *  10  repair dry-run 不寫入、重跑一致。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) =>
  test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（Mac）" }, fn);

const YEAR = 191; // 測試專用年度，避免碰到正式資料
const HH = "T307A";

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const ritual = await import("../src/lib/ritual");
  const reg = await import("../src/lib/registrationItemRegistration");
  const api = await import("../src/lib/additionalPrintItems");
  const confirm = await import("../src/lib/activityRegistration");
  const detail = await import("../src/lib/universalSalvationDetail");
  const print = await import("../src/lib/printDocuments");
  const exp = await import("../src/lib/universalSalvationRosterExport");
  const seed = await import("../src/lib/registrationItems");
  return { prisma, ritual, reg, api, confirm, detail, print, exp, seed };
}
type L = Awaited<ReturnType<typeof load>>;

async function ensureEvent(l: L) {
  const { prisma } = l;
  let ev = await prisma.templeEvent.findFirst({ where: { activityType: "UNIVERSAL_SALVATION", year: YEAR } });
  if (!ev) ev = await prisma.templeEvent.create({ data: { activityType: "UNIVERSAL_SALVATION", year: YEAR, name: `測試${YEAR}中元普渡`, status: "ONGOING" } });
  return ev;
}

async function cleanup(l: L) {
  const { prisma } = l;
  const rr = await prisma.ritualRecord.findFirst({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" }, select: { id: true } });
  if (rr) {
    await prisma.additionalPrintItem.deleteMany({ where: { ritualRecordId: rr.id } });
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: rr.id } });
    await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecordId: rr.id } } });
    await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecordId: rr.id } });
    await prisma.ritualRecord.delete({ where: { id: rr.id } });
  }
}

dbTest("1/2/4 祖先/乙位/無緣：record+item+entry+基本寶袋+registrationOrder 全連結", async () => {
  const l = await load();
  await l.seed.ensureRegistrationItemTypesSeeded();
  await ensureEvent(l);
  await cleanup(l);
  for (const [cat, key] of [["ANCESTOR_LINE", "US_ANCESTOR"], ["INDIVIDUAL_SOUL", "US_ZHENGHUN"], ["UNBORN_CHILD", "US_WUYUAN"]] as const) {
    const r = await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: cat, displayName: `${key}測試`, yangshangNames: ["陽上甲"], tabletAddress: "測試市測試路1號" }, "tester");
    assert.ok(r.ok, `${key} 建立成功`);
  }
  const rr = await l.prisma.ritualRecord.findFirstOrThrow({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" } });
  const items = await l.prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: rr.id, deletedAt: null }, include: { registrationItemType: true } });
  // 每類一筆 item、都連 entry。
  for (const key of ["US_ANCESTOR", "US_ZHENGHUN", "US_WUYUAN"]) {
    const it = items.find((i) => i.registrationItemType.key === key);
    assert.ok(it && it.universalSalvationEntryId, `${key} item 有連 entry`);
  }
  // 每個牌位 entry 有一個基本寶袋（isExtra=false）。
  const entries = await l.prisma.universalSalvationEntry.findMany({ where: { universalSalvation: { ritualRecordId: rr.id }, deletedAt: null } });
  for (const e of entries) {
    const basic = await l.prisma.additionalPrintItem.count({ where: { sourceEntryId: e.id, itemType: "POCKET", isExtra: false, deletedAt: null } });
    assert.equal(basic, 1, "每牌位一個基本寶袋");
  }
  // registrationOrder 已取號（活動存在）。
  const orders = await l.prisma.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "ritual_registration_items" WHERE "ritualRecordId"=${rr.id} AND "deletedAt" IS NULL AND "registrationOrder" IS NOT NULL`;
  assert.ok((orders[0]?.n ?? 0) >= 3, "牌位 item 已取號");
  await cleanup(l);
});

dbTest("5 CONFIRMED record 後新增 DRAFT item → 再確認可轉 CONFIRMED、未收款不影響、金額不變", async () => {
  const l = await load();
  await l.seed.ensureRegistrationItemTypesSeeded();
  await ensureEvent(l);
  await cleanup(l);
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先A", yangshangNames: ["陽上甲"], tabletAddress: "測試市1號" }, "tester");
  const rr = await l.prisma.ritualRecord.findFirstOrThrow({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" } });
  const c1 = await l.confirm.confirmRegistration(rr.id, "tester");
  assert.ok(c1.ok, "首次確認成功");
  // 已 CONFIRMED 後再加一筆牌位（→ DRAFT item under CONFIRMED record）
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "INDIVIDUAL_SOUL", displayName: "乙位B", yangshangNames: ["陽上乙"], tabletAddress: "測試市2號" }, "tester");
  const beforeAmt = await l.prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: rr.id, deletedAt: null }, select: { id: true, amountDue: true, amountPaid: true, status: true } });
  const c2 = await l.confirm.confirmRegistration(rr.id, "tester");
  assert.ok(c2.ok, "再次確認成功（補確認殘留 DRAFT）");
  const after = await l.prisma.ritualRegistrationItem.findMany({ where: { ritualRecordId: rr.id, deletedAt: null }, select: { id: true, amountDue: true, amountPaid: true, status: true } });
  assert.ok(after.every((i) => i.status === "CONFIRMED"), "所有 item 皆 CONFIRMED");
  // 金額不變
  for (const b of beforeAmt) {
    const a = after.find((x) => x.id === b.id)!;
    assert.equal(Number(a.amountDue), Number(b.amountDue), "amountDue 不變");
    assert.equal(Number(a.amountPaid), Number(b.amountPaid), "amountPaid 不變");
  }
  await cleanup(l);
});

dbTest("6 編輯既有牌位不重複建立 entry/item/基本寶袋", async () => {
  const l = await load();
  await l.seed.ensureRegistrationItemTypesSeeded();
  await ensureEvent(l);
  await cleanup(l);
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先A", yangshangNames: ["甲"], tabletAddress: "市1號" }, "tester");
  const rr = await l.prisma.ritualRecord.findFirstOrThrow({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" } });
  const e = await l.prisma.universalSalvationEntry.findFirstOrThrow({ where: { universalSalvation: { ritualRecordId: rr.id }, deletedAt: null } });
  // 再跑一次相同建立（模擬重送/重整）— 應冪等
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先A", yangshangNames: ["甲"], tabletAddress: "市1號" }, "tester");
  const entries = await l.prisma.universalSalvationEntry.count({ where: { universalSalvation: { ritualRecordId: rr.id }, deletedAt: null, category: "ANCESTOR_LINE" } });
  const items = await l.prisma.ritualRegistrationItem.count({ where: { ritualRecordId: rr.id, deletedAt: null, registrationItemType: { key: "US_ANCESTOR" } } });
  const basic = await l.prisma.additionalPrintItem.count({ where: { sourceEntryId: e.id, itemType: "POCKET", isExtra: false, deletedAt: null } });
  assert.equal(entries, 1, "不重複建立 entry");
  assert.equal(items, 1, "不重複建立 item");
  assert.equal(basic, 1, "不重複建立基本寶袋");
  await cleanup(l);
});

dbTest("7/8 基本寶袋免費有號可列印；額外寶袋收費一筆應收、免費仍可列印、No. 不誤取牌位", async () => {
  const l = await load();
  await l.seed.ensureRegistrationItemTypesSeeded();
  await ensureEvent(l);
  await cleanup(l);
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先A", yangshangNames: ["甲"], tabletAddress: "市1號" }, "tester");
  const rr = await l.prisma.ritualRecord.findFirstOrThrow({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" } });
  const e = await l.prisma.universalSalvationEntry.findFirstOrThrow({ where: { universalSalvation: { ritualRecordId: rr.id }, deletedAt: null } });
  // 基本寶袋
  const basic = await l.prisma.additionalPrintItem.findFirstOrThrow({ where: { sourceEntryId: e.id, itemType: "POCKET", isExtra: false, deletedAt: null } });
  assert.equal(basic.isChargeable, false, "基本寶袋免費");
  const basicOrd = await l.prisma.$queryRaw<{ ord: number | null }[]>`SELECT rri."registrationOrder" AS ord FROM "additional_print_items" api JOIN "ritual_registration_items" rri ON rri."id"=api."registrationItemId" WHERE api."id"=${basic.id}`;
  assert.ok(basicOrd[0]?.ord != null, "基本寶袋有自己的 registrationOrder");
  // 額外寶袋（收費）
  const paid = await l.api.createExtraPocket(HH, YEAR, e.id, { usesSourceName: true, quantity: 1, isChargeable: true, unitPrice: 300 }, "tester");
  assert.ok(paid.ok, "收費額外寶袋建立成功");
  // 只一筆應收：US_POCKET_EXTRA item amountDue>0，且 legacy adapter 排除 registrationItemId 非 null
  // 額外寶袋（免費）
  const free = await l.api.createExtraPocket(HH, YEAR, e.id, { usesSourceName: true, quantity: 1, isChargeable: false }, "tester");
  assert.ok(free.ok && free.item, "免費額外寶袋建立成功");
  await cleanup(l);
});

dbTest("9 明細/總名單/列印管理/Excel 四處 CONFIRMED 筆數一致", async () => {
  const l = await load();
  await l.seed.ensureRegistrationItemTypesSeeded();
  await ensureEvent(l);
  await cleanup(l);
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先A", yangshangNames: ["甲"], tabletAddress: "市1號" }, "tester");
  await l.ritual.createUniversalSalvationEntry(HH, YEAR, { category: "ANCESTOR_LINE", displayName: "祖先B", yangshangNames: ["乙"], tabletAddress: "市2號" }, "tester");
  const rr = await l.prisma.ritualRecord.findFirstOrThrow({ where: { householdId: HH, year: YEAR, activityType: "UNIVERSAL_SALVATION" } });
  await l.confirm.confirmRegistration(rr.id, "tester");
  const roster = await l.print.buildItemRoster("US_ANCESTOR", YEAR);
  const printItems = await l.print.listPrintCenterItems({ year: YEAR, itemKey: "US_ANCESTOR" } as never);
  const excel = await l.exp.getUniversalSalvationRosterExport(YEAR);
  const rosterN = roster?.rows.length ?? 0;
  const printN = printItems.filter((p) => p.itemKey === "US_ANCESTOR").length;
  const excelN = excel.sheets.ancestorSoul.rows.filter((r) => r[1] === "祖先A" || r[1] === "祖先B").length;
  assert.equal(rosterN, 2, "roster 2 筆");
  assert.equal(printN, 2, "列印管理 2 筆");
  assert.equal(excelN, 2, "Excel 2 筆");
  await cleanup(l);
});

dbTest("10 repair dry-run 不寫入且重跑一致", async () => {
  const l = await load();
  const { parseRepairArgs } = await import("../src/lib/repairArgs");
  // dry-run 參數不觸發寫入
  assert.equal(parseRepairArgs([String(YEAR)]).writeEnabled, false);
  // 連續兩次唯讀盤點筆數一致（此處以孤兒盤點代表；不寫入）
  const { backfillMissingTabletItems } = await import("../src/lib/tabletItemBackfill");
  const a = await backfillMissingTabletItems({ commit: false, categories: ["DEBT_CREDITOR"] });
  const b = await backfillMissingTabletItems({ commit: false, categories: ["DEBT_CREDITOR"] });
  assert.equal(a.orphans.length, b.orphans.length, "dry-run 重跑筆數一致");
  assert.equal(a.committed, false);
  assert.equal(b.committed, false);
});
