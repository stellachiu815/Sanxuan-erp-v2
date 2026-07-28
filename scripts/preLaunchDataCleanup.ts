/**
 * V24 正式上線前－測試資料全清（Full Clear 模式）。
 *
 * 前提（管理員已確認）：目前家戶、信眾、活動報名、列印及相關業務資料全部都是測試資料，
 * 不需逐戶辨識。本腳本清除「全部非財務業務資料」，並完整保留所有財務與設定資料。
 *
 * 【一律保留，絕不刪除】
 *   財務：payment_transactions/allocations/adjustments、receipts/receipt_lines、
 *         manual_receivables、finance_records、finance_reconciliations、
 *         agent_reconciliation_records、offering_payments、universal_salvation_payments、
 *         purification_payments、temple_event_expenses（活動支出）。
 *   計數器/號碼：payment_sequence_counters、receipt_sequence_counters、receipt_numbering_configs。
 *   設定/帳號：users、sessions、system_settings、temple_events、temple_event_checklist_items、
 *         registration_item_types、offering_types、template_definitions、template_versions、
 *         google_drive_connections、程式碼、Prisma migration。
 *
 * 【強制財務保護】清除前後：finance_records 必須維持 10 筆、金額合計 1,777,735；
 *   且所有財務表筆數/金額不得改變。任一不同即 throw → 整筆交易 rollback。
 *   （若刪除業務資料會連帶影響任何財務表，交易一律回滾、不會提交。）
 *
 * 執行：
 *   npx tsx scripts/preLaunchDataCleanup.ts                       # 乾跑：逐表筆數 + 保留財務快照，不刪
 *   CONFIRM_CLEANUP=YES npx tsx scripts/preLaunchDataCleanup.ts   # 正式全清（受財務保護，失敗即回滾）
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const CONFIRM = process.env.CONFIRM_CLEANUP === "YES";

// 財務保護基準（管理員提供的目前正式值）。
const EXPECTED_FINANCE_RECORDS_COUNT = 10;
const EXPECTED_FINANCE_RECORDS_SUM = 1_777_735;

const money = (n: number) => n.toLocaleString("zh-Hant");
const num = (v: unknown) => Number(v ?? 0);

/** 需受保護、不得變動的財務表快照（筆數＋金額）。 */
async function financeGuardSnapshot() {
  const financeRecordAgg = (prisma.financeRecord as unknown as {
    aggregate: (a: unknown) => Promise<{ _count: { _all: number }; _sum: { amount: unknown } }>;
  }).aggregate;
  const financeReconCount = (prisma as unknown as { financeReconciliation: { count: () => Promise<number> } }).financeReconciliation.count;
  const [pt, alloc, adj, rec, recLine, fin, mr, op, usp, pp, exp, finRecon] = await Promise.all([
    prisma.paymentTransaction.aggregate({ _count: { _all: true }, _sum: { totalAmount: true } }),
    prisma.paymentAllocation.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.paymentAdjustment.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.receipt.count(),
    prisma.receiptLine.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    financeRecordAgg({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.manualReceivable.aggregate({ _count: { _all: true }, _sum: { amountPaid: true } }),
    prisma.offeringPayment.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.universalSalvationPayment.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.purificationPayment.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.templeEventExpense.aggregate({ _count: { _all: true }, _sum: { amount: true } }),
    prisma.agentReconciliationRecord.count(),
  ]);
  const finReconN = await financeReconCount();
  return {
    payment_transactions: { n: pt._count._all, sum: num(pt._sum.totalAmount) },
    payment_allocations: { n: alloc._count._all, sum: num(alloc._sum.amount) },
    payment_adjustments: { n: adj._count._all, sum: num(adj._sum.amount) },
    receipts: { n: rec, sum: 0 },
    receipt_lines: { n: recLine._count._all, sum: num(recLine._sum.amount) },
    finance_records: { n: fin._count._all, sum: num(fin._sum.amount) },
    finance_reconciliations: { n: finReconN, sum: 0 },
    manual_receivables: { n: mr._count._all, sum: num(mr._sum.amountPaid) },
    offering_payments: { n: op._count._all, sum: num(op._sum.amount) },
    universal_salvation_payments: { n: usp._count._all, sum: num(usp._sum.amount) },
    purification_payments: { n: pp._count._all, sum: num(pp._sum.amount) },
    temple_event_expenses: { n: exp._count._all, sum: num(exp._sum.amount) },
    agent_reconciliation_records: { n: finRecon, sum: 0 },
  };
}

/** 依外鍵子→父順序的清除步驟（全表清空；不含任何財務表）。 */
function clearSteps() {
  return [
    { name: "additional_print_items", count: () => prisma.additionalPrintItem.count(), del: () => prisma.additionalPrintItem.deleteMany() },
    { name: "ritual_registration_items", count: () => prisma.ritualRegistrationItem.count(), del: () => prisma.ritualRegistrationItem.deleteMany() },
    { name: "ritual_participants", count: () => prisma.ritualParticipant.count(), del: () => prisma.ritualParticipant.deleteMany() },
    { name: "lantern_registrations", count: () => prisma.lanternRegistration.count(), del: () => prisma.lanternRegistration.deleteMany() },
    { name: "universal_salvation_entries", count: () => prisma.universalSalvationEntry.count(), del: () => prisma.universalSalvationEntry.deleteMany() },
    { name: "universal_salvation_details", count: () => prisma.universalSalvationDetail.count(), del: () => prisma.universalSalvationDetail.deleteMany() },
    { name: "family_lantern_members", count: () => prisma.familyLanternMember.count(), del: () => prisma.familyLanternMember.deleteMany() },
    { name: "family_lantern_registrations", count: () => prisma.familyLanternRegistration.count(), del: () => prisma.familyLanternRegistration.deleteMany() },
    { name: "purification_banned_numbers", count: () => prisma.purificationBannedNumber.count(), del: () => prisma.purificationBannedNumber.deleteMany() },
    { name: "purification_entries", count: () => prisma.purificationEntry.count(), del: () => prisma.purificationEntry.deleteMany() },
    { name: "purification_import_rows", count: () => prisma.purificationImportRow.count(), del: () => prisma.purificationImportRow.deleteMany() },
    { name: "purification_import_batches", count: () => prisma.purificationImportBatch.count(), del: () => prisma.purificationImportBatch.deleteMany() },
    { name: "ritual_records", count: () => prisma.ritualRecord.count(), del: () => prisma.ritualRecord.deleteMany() },
    { name: "offering_claims", count: () => prisma.offeringClaim.count(), del: () => prisma.offeringClaim.deleteMany() },
    { name: "floral_offering_slots", count: () => prisma.floralOfferingSlot.count(), del: () => prisma.floralOfferingSlot.deleteMany() },
    { name: "activity_offerings", count: () => prisma.activityOffering.count(), del: () => prisma.activityOffering.deleteMany() },
    { name: "stove_master_registrations", count: () => prisma.stoveMasterRegistration.count(), del: () => prisma.stoveMasterRegistration.deleteMany() },
    { name: "temple_event_print_batches", count: () => prisma.templeEventPrintBatch.count(), del: () => prisma.templeEventPrintBatch.deleteMany() },
    { name: "temple_event_banned_numbers", count: () => prisma.templeEventBannedNumber.count(), del: () => prisma.templeEventBannedNumber.deleteMany() },
    { name: "import_rows", count: () => prisma.importRow.count(), del: () => prisma.importRow.deleteMany() },
    { name: "import_batches", count: () => prisma.importBatch.count(), del: () => prisma.importBatch.deleteMany() },
    { name: "import_field_mappings", count: () => prisma.importFieldMapping.count(), del: () => prisma.importFieldMapping.deleteMany() },
    { name: "devotee_care_records", count: () => prisma.devoteeCareRecord.count(), del: () => prisma.devoteeCareRecord.deleteMany() },
    { name: "devotee_interactions", count: () => prisma.devoteeInteraction.count(), del: () => prisma.devoteeInteraction.deleteMany() },
    { name: "devotee_tag_assignments", count: () => prisma.devoteeTagAssignment.count(), del: () => prisma.devoteeTagAssignment.deleteMany() },
    { name: "devotee_tags", count: () => prisma.devoteeTag.count(), del: () => prisma.devoteeTag.deleteMany() },
    { name: "devotee_profiles", count: () => prisma.devoteeProfile.count(), del: () => prisma.devoteeProfile.deleteMany() },
    { name: "worship_records", count: () => prisma.worshipRecord.count(), del: () => prisma.worshipRecord.deleteMany() },
    { name: "members", count: () => prisma.member.count(), del: () => prisma.member.deleteMany() },
    { name: "household_yangshang", count: () => prisma.householdYangshang.count(), del: () => prisma.householdYangshang.deleteMany() },
    { name: "household_code_aliases", count: () => prisma.householdCodeAlias.count(), del: () => prisma.householdCodeAlias.deleteMany() },
    { name: "households", count: () => prisma.household.count(), del: () => prisma.household.deleteMany() },
    { name: "activities", count: () => prisma.activity.count(), del: () => prisma.activity.deleteMany() },
    { name: "record_versions", count: () => prisma.recordVersion.count(), del: () => prisma.recordVersion.deleteMany() },
    { name: "audit_logs", count: () => prisma.auditLog.count(), del: () => prisma.auditLog.deleteMany() },
    { name: "backup_logs", count: () => prisma.backupLog.count(), del: () => prisma.backupLog.deleteMany() },
  ];
}

function assertFinanceBaseline(snap: Awaited<ReturnType<typeof financeGuardSnapshot>>) {
  const fr = snap.finance_records;
  if (fr.n !== EXPECTED_FINANCE_RECORDS_COUNT || fr.sum !== EXPECTED_FINANCE_RECORDS_SUM) {
    throw new Error(
      `財務基準不符：finance_records 目前 ${fr.n} 筆／金額 ${fr.sum}，` +
        `預期 ${EXPECTED_FINANCE_RECORDS_COUNT} 筆／${EXPECTED_FINANCE_RECORDS_SUM}。請先確認財務資料無誤再執行。`
    );
  }
}

async function main() {
  console.log(`\n=== V24 測試資料全清（${CONFIRM ? "正式模式" : "乾跑 DRY-RUN"}）===\n`);

  const steps = clearSteps();
  let total = 0;
  console.log("── 將清除的資料表（目前筆數）──");
  for (const s of steps) {
    const c = await s.count();
    total += c;
    console.log(`${c.toString().padStart(8)}  ${s.name}`);
  }
  console.log(`\n清除總筆數：${total} 筆`);

  console.log("\n── 保留財務快照（清除前）──");
  const before = await financeGuardSnapshot();
  for (const [t, v] of Object.entries(before)) console.log(`  ${t}：${v.n} 筆${v.sum ? `，金額合計 ${money(v.sum)}` : ""}`);
  const fr = before.finance_records;
  const baselineOk = fr.n === EXPECTED_FINANCE_RECORDS_COUNT && fr.sum === EXPECTED_FINANCE_RECORDS_SUM;
  console.log(`\n財務基準檢查：finance_records = ${fr.n} 筆／${money(fr.sum)}（預期 ${EXPECTED_FINANCE_RECORDS_COUNT} 筆／${money(EXPECTED_FINANCE_RECORDS_SUM)}）→ ${baselineOk ? "✅ 相符" : "⚠️ 不符"}`);

  if (!CONFIRM) {
    console.log("\n（乾跑結束，未刪任何資料。確認上方無誤後，帶 CONFIRM_CLEANUP=YES 再執行。）\n");
    return;
  }

  // 正式模式：先驗基準，再於單一交易內清除並前後比對財務快照。
  assertFinanceBaseline(before);

  let deleted = 0;
  await prisma.$transaction(async () => {
    for (const s of steps) {
      const r = await s.del();
      deleted += r.count;
      console.log(`已清除 ${r.count.toString().padStart(8)}  ${s.name}`);
    }
    const after = await financeGuardSnapshot();
    assertFinanceBaseline(after);
    for (const k of Object.keys(before) as (keyof typeof before)[]) {
      if (before[k].n !== after[k].n || before[k].sum !== after[k].sum) {
        throw new Error(`財務保護失敗：${k} 前後改變（${before[k].n}/${before[k].sum} → ${after[k].n}/${after[k].sum}），已回滾。`);
      }
    }
  }, { timeout: 180_000 });

  console.log(`\n✅ 完成。共清除 ${deleted} 筆測試業務資料。`);
  console.log("財務表筆數/金額前後一致，finance_records 維持 10 筆／1,777,735，號碼計數器與已用號碼未動。\n");
}

main()
  .catch((e) => {
    console.error("清除中止（已回滾）：", e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
