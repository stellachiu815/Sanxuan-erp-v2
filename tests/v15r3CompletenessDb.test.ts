import { test } from "node:test";
import assert from "node:assert/strict";

/**
 * V15R3 完整度 gating — DB 級整合測試（待 Mac）。
 *
 * ⚠️ 需真實測試資料庫，預設**跳過**（未設 RUN_DB_TESTS）。Mac／staging 執行：
 *   RUN_DB_TESTS=1 DATABASE_URL=<獨立測試庫，切勿正式庫> npx tsx --test tests/v15r3CompletenessDb.test.ts
 *
 * prisma／service／route 一律在測試內**動態 import**，避免預設執行觸發 Prisma 引擎。
 * 這是 **DB integration test**（非 source-scan／pure）——實際建立資料、呼叫 route handler、
 * 檢查 DB 前後欄位。涵蓋確認 gating、列印 gating、預覽不寫入、批次整批擋、READONLY。
 */
const RUN = !!process.env.RUN_DB_TESTS;
const dbTest = (name: string, fn: () => Promise<void>) => test(name, { skip: !RUN && "需 RUN_DB_TESTS=1 與測試資料庫（待 Mac）" }, fn);

async function load() {
  const { prisma } = await import("../src/lib/prisma");
  const gate = await import("../src/lib/completenessGate");
  const ritual = await import("../src/lib/ritual");
  return { prisma, gate, ritual };
}

type Prisma = Awaited<ReturnType<typeof load>>["prisma"];

/** 建立一戶＋一位成員＋一筆普渡 DRAFT record＋Detail；回 ids 與清理。 */
async function seedUS(prisma: Prisma) {
  const hhId = `T${Math.random().toString(36).slice(2, 9)}`.slice(0, 10);
  const household = await prisma.household.create({ data: { id: hhId, name: "測試家戶", address: "測試家戶地址1號" } });
  const member = await prisma.member.create({ data: { householdId: household.id, name: "測試信眾", isPrimaryContact: true } });
  const record = await prisma.ritualRecord.create({
    data: { householdId: household.id, year: 999, activityType: "UNIVERSAL_SALVATION", status: "DRAFT", registrationSource: "DEVOTEE_PAGE" },
  });
  await prisma.universalSalvationDetail.create({ data: { ritualRecordId: record.id, isRegistered: true } });
  const cleanup = async () => {
    await prisma.additionalPrintItem.deleteMany({ where: { ritualRecordId: record.id } });
    await prisma.ritualRegistrationItem.deleteMany({ where: { ritualRecordId: record.id } });
    await prisma.universalSalvationEntry.deleteMany({ where: { universalSalvation: { ritualRecordId: record.id } } });
    await prisma.universalSalvationDetail.deleteMany({ where: { ritualRecordId: record.id } });
    await prisma.ritualRecord.deleteMany({ where: { id: record.id } });
    await prisma.member.deleteMany({ where: { householdId: household.id } });
    await prisma.household.deleteMany({ where: { id: household.id } });
  };
  return { householdId: household.id, memberId: member.id, recordId: record.id, cleanup };
}

// ── 一、確認 gating ────────────────────────────────────────

dbTest("1. 普渡缺牌位地址：checkRitualRecordCompleteness 不完整＋含『牌位地址』；record 維持 DRAFT", async () => {
  const { prisma, gate, ritual } = await load();
  const s = await seedUS(prisma);
  try {
    // 祖先牌位：有陽上人、但**清空地址**（覆蓋自動帶入）。
    await ritual.createUniversalSalvationEntry(s.householdId, 999, { category: "ANCESTOR_LINE", displayName: "測試祖先", yangshangNames: ["測試信眾"], tabletAddress: "" }, "測試");
    // 直接把該筆 entry 地址清空（模擬缺地址）。
    await prisma.universalSalvationEntry.updateMany({ where: { universalSalvation: { ritualRecordId: s.recordId } }, data: { tabletAddress: null } });

    const c = await gate.checkRitualRecordCompleteness(s.recordId);
    assert.equal(c.complete, false);
    assert.ok(c.missing.some((m) => m.label === "牌位地址"), "缺項需含『牌位地址』");

    const rec = await prisma.ritualRecord.findUnique({ where: { id: s.recordId }, select: { status: true } });
    assert.equal(rec!.status, "DRAFT", "確認 gating 未通過，維持 DRAFT");
  } finally {
    await s.cleanup();
  }
});

dbTest("2/3. 年度燈／龍鳳燈缺必要資料 → 完整度不通過（同確認路由 gating）", async () => {
  const { prisma, gate } = await load();
  const s = await seedUS(prisma);
  try {
    // 借用同一 record 掛一筆年度燈項目（member 無生日／生肖）→ 應判缺農曆生日/生肖。
    const lantern = await prisma.registrationItemType.findUnique({ where: { key: "LANTERN_GUANGMING" }, select: { id: true } });
    if (lantern) {
      await prisma.ritualRegistrationItem.create({ data: { ritualRecordId: s.recordId, registrationItemTypeId: lantern.id, memberId: s.memberId, quantity: 1, amountDue: 500, amountUnpaid: 500, status: "DRAFT" } });
      const c = await gate.checkRitualRecordCompleteness(s.recordId);
      assert.equal(c.complete, false, "年度燈缺生日/生肖 → 不完整");
      assert.ok(c.missing.some((m) => m.label === "農曆生日" || m.label === "生肖"));
    }
  } finally {
    await s.cleanup();
  }
});

// ── 二、正式列印 gating＋預覽不寫入 ─────────────────────────

dbTest("4/6. 批次列印：一完整一不完整 → 整批 422、完整那筆也不增列印紀錄", async () => {
  const { prisma, gate } = await load();
  const s = await seedUS(prisma);
  try {
    // 缺地址祖先牌位（連動建立 TABLET/POCKET 列印物件）。
    const { createUniversalSalvationEntry } = await import("../src/lib/ritual");
    await createUniversalSalvationEntry(s.householdId, 999, { category: "ANCESTOR_LINE", displayName: "缺地址祖先", yangshangNames: ["測試信眾"], tabletAddress: "" }, "測試");
    await prisma.universalSalvationEntry.updateMany({ where: { universalSalvation: { ritualRecordId: s.recordId } }, data: { tabletAddress: null } });

    const objs = await prisma.additionalPrintItem.findMany({ where: { ritualRecordId: s.recordId }, select: { id: true, printCount: true, firstPrintedAt: true } });
    const recordIds = await gate.ritualRecordIdsForPrintObjects(objs.map((o) => o.id));
    const g = await gate.checkRitualRecordsCompleteness(recordIds);
    assert.equal(g.allComplete, false, "有不完整報名 → 整批不可列印");
    assert.ok(g.incompleteRecords.length > 0);

    // 未通過 gating 時（呼叫端會回 422、不執行 confirmPrintObjects）→ 列印狀態不變。
    const after = await prisma.additionalPrintItem.findMany({ where: { ritualRecordId: s.recordId }, select: { printCount: true, firstPrintedAt: true } });
    for (const a of after) {
      assert.equal(a.printCount, 0);
      assert.equal(a.firstPrintedAt, null);
    }
  } finally {
    await s.cleanup();
  }
});

dbTest("5. 預覽（純讀取 gate／listRegisteredItems）呼叫前後：列印狀態完全不變", async () => {
  const { prisma, gate } = await load();
  const s = await seedUS(prisma);
  try {
    const { createUniversalSalvationEntry } = await import("../src/lib/ritual");
    await createUniversalSalvationEntry(s.householdId, 999, { category: "ANCESTOR_LINE", displayName: "祖先", yangshangNames: ["測試信眾"], tabletAddress: "" }, "測試");
    const before = await prisma.additionalPrintItem.findMany({ where: { ritualRecordId: s.recordId } });
    // 「預覽」等同純讀取 gate／清單，不寫入。
    await gate.checkRitualRecordCompleteness(s.recordId);
    const after = await prisma.additionalPrintItem.findMany({ where: { ritualRecordId: s.recordId } });
    assert.deepEqual(after, before, "預覽/純讀取不得改任何列印狀態");
  } finally {
    await s.cleanup();
  }
});

// ── 三、READONLY 後端阻擋 ──────────────────────────────────

dbTest("7. READONLY：summary/list GET 200；confirm／print 寫入 API 403（後端阻擋，非只前端隱藏）", async () => {
  const { prisma } = await load();
  const s = await seedUS(prisma);
  try {
    const roId = process.env.READONLY_OPERATOR_USER_ID ?? "";
    const mk = (url: string) => new Request(url) as unknown as import("next/server").NextRequest;

    // 純讀取 API 應 200。
    const { GET: summaryGet } = await import("../src/app/api/data-completeness/summary/route");
    const sres = await summaryGet(mk(`http://localhost/api/data-completeness/summary?operatorUserId=${roId}`));
    assert.equal(sres.status, 200, "READONLY 可看 summary");

    // 正式列印寫入 API 應 403（READONLY 無 print 權限）。
    const { POST: printConfirm } = await import("../src/app/api/universal-salvation/[year]/print-items/confirm/route");
    const pres = await printConfirm(
      new Request(`http://localhost/api/universal-salvation/999/print-items/confirm`, { method: "POST", body: JSON.stringify({ ids: ["x"], idempotencyKey: "k", operatorUserId: roId }) }) as unknown as import("next/server").NextRequest,
      { params: Promise.resolve({ year: "999" }) }
    );
    assert.equal(pres.status, 403, "READONLY 正式列印應 403");
  } finally {
    await s.cleanup();
  }
});
