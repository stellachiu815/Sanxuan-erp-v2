/**
 * V35.1：單筆孤立普渡報名唯讀追查（只 SELECT，不修改/刪除/commit/migration）。
 *
 *   npx tsx scripts/diagnoseOrphanUS115Single.ts
 *
 * 目標 ritualRecord.id = cms71s5nd009mdv1so6im7aao（可用 --id=xxx 覆寫）。
 */
import { prisma } from "../src/lib/prisma";

const DEFAULT_ID = "cms71s5nd009mdv1so6im7aao";

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...p);
}
const num = (v: unknown) => Number(v ?? 0) || 0;

async function main() {
  const idArg = process.argv.find((a) => a.startsWith("--id="));
  const RR_ID = idArg ? idArg.slice(5) : DEFAULT_ID;

  const rr = (await q<{ id: string; status: string; householdId: string; templeEventId: string | null; year: number; activityType: string; createdAt: Date; deletedAt: Date | null }>(
    `SELECT "id","status","householdId","templeEventId","year","activityType"::text AS "activityType","createdAt","deletedAt"
     FROM "ritual_records" WHERE "id"=$1`, RR_ID
  ))[0];
  if (!rr) { console.error(`找不到 ritualRecord ${RR_ID}，停止。`); process.exit(1); }

  // RitualRegistrationItem（含金額/列印）
  const rri = await q<{ id: string; amountDue: string; amountPaid: string; amountUnpaid: string; printCount: number; printedAt: Date | null; status: string; key: string }>(
    `SELECT rri."id", rri."amountDue", rri."amountPaid", rri."amountUnpaid", rri."printCount", rri."printedAt", rri."status", rit."key"
     FROM "ritual_registration_items" rri
     LEFT JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
     WHERE rri."ritualRecordId"=$1`, RR_ID
  );
  // UniversalSalvationDetail（含贊普金額）
  const details = await q<{ id: string; amountDue: string; amountPaid: string; amountUnpaid: string }>(
    `SELECT "id","amountDue","amountPaid","amountUnpaid" FROM "universal_salvation_details" WHERE "ritualRecordId"=$1`, RR_ID
  );
  const detailIds = details.map((d) => d.id);
  const detIn = detailIds.length ? detailIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : null;

  const entriesN = detIn ? num((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${detIn})`))[0]?.n) : 0;
  const usPayN = detIn ? num((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detIn})`))[0]?.n) : 0;

  const api = await q<{ id: string; printCount: number; printedAt: Date | null; itemType: string }>(
    `SELECT "id","printCount","printedAt","itemType"::text AS "itemType" FROM "additional_print_items" WHERE "ritualRecordId"=$1`, RR_ID
  );

  // 財務多型 sourceId：牌位/白米=rri.id、贊普=detail.id、寶袋=api.id
  const sourceIds = [...rri.map((r) => r.id), ...detailIds, ...api.map((a) => a.id)];
  const srcIn = sourceIds.length ? sourceIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : null;

  const allocRows = srcIn ? await q<{ sid: string; st: string; txn: string }>(
    `SELECT pa."sourceId" AS sid, pt."status"::text AS st, pt."transactionNo" AS txn
     FROM "payment_allocations" pa JOIN "payment_transactions" pt ON pt."id"=pa."paymentTransactionId"
     WHERE pa."sourceId" IN (${srcIn})`) : [];
  const receiptLines = srcIn ? await q<{ sid: string }>(`SELECT "sourceId" AS sid FROM "receipt_lines" WHERE "sourceId" IN (${srcIn})`) : [];
  const completedAlloc = allocRows.filter((a) => a.st === "COMPLETED");

  // 金額彙總（rri + detail）
  const amountDue = rri.reduce((s, r) => s + num(r.amountDue), 0) + details.reduce((s, d) => s + num(d.amountDue), 0);
  const amountPaid = rri.reduce((s, r) => s + num(r.amountPaid), 0) + details.reduce((s, d) => s + num(d.amountPaid), 0);
  const amountUnpaid = rri.reduce((s, r) => s + num(r.amountUnpaid), 0) + details.reduce((s, d) => s + num(d.amountUnpaid), 0);

  const maxPrintCount = Math.max(0, ...rri.map((r) => num(r.printCount)), ...api.map((a) => num(a.printCount)));
  const printedAts = [...rri.map((r) => r.printedAt), ...api.map((a) => a.printedAt)].filter(Boolean) as Date[];
  const firstPrintedAt = printedAts.length ? printedAts.map((d) => new Date(d)).sort((a, b) => +a - +b)[0] : null;

  // 安全硬刪判定（V35 財務保護：任何收款足跡 → NO）
  const financeSignals: string[] = [];
  if (amountPaid > 0) financeSignals.push(`amountPaid=${amountPaid}>0`);
  if (usPayN > 0) financeSignals.push(`UniversalSalvationPayment ${usPayN} 筆`);
  if (receiptLines.length > 0) financeSignals.push(`ReceiptLine ${receiptLines.length} 筆`);
  if (completedAlloc.length > 0) financeSignals.push(`COMPLETED 收款分配 ${completedAlloc.length} 筆`);
  const safeHardDelete = financeSignals.length === 0;

  console.log("=== V35.1 單筆孤立普渡報名唯讀追查 ===");
  console.log(`ritualRecord.id：${rr.id}`);
  console.log(`（status=${rr.status}${rr.deletedAt ? "，已軟刪" : ""}｜household=${rr.householdId}｜templeEventId=${rr.templeEventId ?? "NULL"}｜${rr.activityType}/${rr.year}｜建立 ${new Date(rr.createdAt).toISOString()}）`);
  console.log("");
  console.log(`1. amountDue                       ：${amountDue}`);
  console.log(`2. amountPaid                      ：${amountPaid}`);
  console.log(`3. amountUnpaid                    ：${amountUnpaid}`);
  console.log(`4. UniversalSalvationPayment       ：${usPayN > 0 ? `有（${usPayN} 筆）` : "無"}`);
  console.log(`5. Receipt／ReceiptLine            ：${receiptLines.length > 0 ? `有（ReceiptLine ${receiptLines.length} 筆）` : "無"}`);
  console.log(`6. 收款分配／COMPLETED 收款交易    ：${completedAlloc.length > 0 ? `有（${completedAlloc.length} 筆，交易 ${[...new Set(completedAlloc.map((a) => a.txn))].join(", ")}）` : `無${allocRows.length > completedAlloc.length ? `（另有非 COMPLETED 分配 ${allocRows.length - completedAlloc.length} 筆）` : ""}`}`);
  console.log(`7. printCount（最大）              ：${maxPrintCount}`);
  console.log(`8. printedAt（最早）               ：${firstPrintedAt ? firstPrintedAt.toISOString() : "無"}`);
  console.log(`9. UniversalSalvationDetail        ：${details.length} 筆${details.length ? `（id: ${detailIds.join(", ")}）` : ""}`);
  console.log(`10. UniversalSalvationEntry        ：${entriesN} 筆`);
  console.log(`11. AdditionalPrintItem            ：${api.length} 筆${api.length ? `（${api.map((a) => a.itemType).join("、")}）` : ""}`);
  console.log(`12. RitualRegistrationItem         ：${rri.length} 筆${rri.length ? `（${rri.map((r) => `${r.key ?? "?"}:${r.status}`).join("、")}）` : ""}`);
  console.log(`13. 是否可安全硬刪                 ：${safeHardDelete ? "YES" : "NO"}`);
  console.log(`14. 原因                           ：${safeHardDelete
    ? "無任何收款足跡（amountPaid=0、無 UniversalSalvationPayment、無 ReceiptLine、無 COMPLETED 收款分配）；僅為報名結構資料，硬刪不影響財務正式資料。"
    : `偵測到財務足跡，不建議硬刪：${financeSignals.join("；")}。`}`);
  if (maxPrintCount > 0 && safeHardDelete) console.log(`   附註：printCount=${maxPrintCount}（曾列印，屬列印紀錄非財務；依 V35 規則不阻擋硬刪，僅提醒）。`);
  console.log("\n（全程唯讀，未修改任何資料。）");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
