/**
 * V35.2：單筆孤立普渡報名硬刪（dry-run 預設；--commit 才刪除）。
 *
 * 只處理這一個 ritualRecord id，其餘一律不碰。
 *   目標 ritualRecord.id = cms71s5nd009mdv1so6im7aao
 *
 * 安全規格：
 *   - 只針對這一筆 id（寫死；不掃描、不批次）。先確認它存在且為 UNIVERSAL_SALVATION。
 *   - 單一 transaction、all-or-nothing。
 *   - transaction 內再次驗證：無 amountPaid>0、無 UniversalSalvationPayment、無 ReceiptLine、
 *     無任何收款分配（payment_allocations，含 COMPLETED 收款交易）。有任一財務足跡 → 立即 throw 中止（不刪）。
 *   - 每一句 DELETE 都帶明確 WHERE（單筆 id 或其子表明確 id 清單），無 TRUNCATE、無全表 DELETE。
 *   - 不刪 Household / Member / WorshipRecord / 其他活動 / 正式財務資料。
 *
 *   # 1) 預覽（唯讀）
 *   npx tsx scripts/resetOrphanUS115Single.ts
 *   # 2) 正式硬刪（單一交易、交易內重驗財務）
 *   npx tsx scripts/resetOrphanUS115Single.ts --commit
 */
import { prisma } from "../src/lib/prisma";

const RR_ID = "cms71s5nd009mdv1so6im7aao";
const ACTIVITY = "UNIVERSAL_SALVATION";

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql, ...p);
}
function inList(ids: string[]): string | null {
  const safe = ids.filter(Boolean).map((s) => `'${s.replace(/'/g, "''")}'`);
  return safe.length ? safe.join(",") : null;
}
const cnt = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0) || 0;

async function main() {
  const commit = process.argv.includes("--commit");
  console.log("=== V35.2 單筆孤立普渡報名硬刪 ===");
  console.log(`模式：${commit ? "COMMIT（會硬刪除）" : "DRY-RUN（唯讀）"}`);
  console.log(`目標 ritualRecord.id：${RR_ID}`);

  // 0) 目標必須存在且為普渡（安全鎖）。
  const rr = (await q<{ id: string; activityType: string; year: number; status: string; householdId: string; templeEventId: string | null; deletedAt: Date | null }>(
    `SELECT "id","activityType"::text AS "activityType","year","status","householdId","templeEventId","deletedAt"
     FROM "ritual_records" WHERE "id"=$1`, RR_ID
  ))[0];
  if (!rr) { console.error(`找不到 ritualRecord ${RR_ID}，停止。`); process.exit(1); }
  if (rr.activityType !== ACTIVITY) { console.error(`ritualRecord ${RR_ID} activityType=${rr.activityType}≠${ACTIVITY}，為安全起見停止。`); process.exit(1); }
  console.log(`（year=${rr.year}｜status=${rr.status}${rr.deletedAt ? "，已軟刪" : ""}｜household=${rr.householdId}｜templeEventId=${rr.templeEventId ?? "NULL"}）`);

  // 1) 子資料 id。
  const details = await q<{ id: string }>(`SELECT "id" FROM "universal_salvation_details" WHERE "ritualRecordId"=$1`, RR_ID);
  const detailIds = details.map((d) => d.id);
  const detIn = inList(detailIds);
  const rri = await q<{ id: string }>(`SELECT "id" FROM "ritual_registration_items" WHERE "ritualRecordId"=$1`, RR_ID);
  const api = await q<{ id: string }>(`SELECT "id" FROM "additional_print_items" WHERE "ritualRecordId"=$1`, RR_ID);

  // 2) 各表預計刪除筆數。
  const nEntries = detIn ? cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${detIn})`)) : 0;
  const nUsPay = detIn ? cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detIn})`)) : 0;
  const nParticipants = cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "ritual_participants" WHERE "ritualRecordId"=$1`, RR_ID));

  // 3) 財務足跡（dry-run 先報，commit 交易內再驗一次）。
  const sourceIds = [...rri.map((r) => r.id), ...detailIds, ...api.map((a) => a.id)];
  const srcIn = inList(sourceIds);
  const nPaidItems = cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "ritual_registration_items" WHERE "ritualRecordId"=$1 AND "amountPaid" > 0`, RR_ID));
  const nPaidDetail = detIn ? cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_details" WHERE "ritualRecordId"=$1 AND "amountPaid" > 0`, RR_ID)) : 0;
  const nAlloc = srcIn ? cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${srcIn})`)) : 0;
  const nReceiptLine = srcIn ? cnt(await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${srcIn})`)) : 0;
  const financeFootprint = nPaidItems + nPaidDetail + nUsPay + nAlloc + nReceiptLine;

  console.log("\n各關聯表預計刪除筆數：");
  console.log(`  additional_print_items     ：${api.length}`);
  console.log(`  universal_salvation_payments：${nUsPay}`);
  console.log(`  universal_salvation_entries ：${nEntries}`);
  console.log(`  ritual_registration_items  ：${rri.length}`);
  console.log(`  ritual_participants        ：${nParticipants}`);
  console.log(`  universal_salvation_details ：${details.length}`);
  console.log(`  ritual_records             ：1`);
  console.log(`\n財務足跡檢查：amountPaid>0 項目 ${nPaidItems}｜贊普已收 ${nPaidDetail}｜UniversalSalvationPayment ${nUsPay}｜收款分配 ${nAlloc}｜ReceiptLine ${nReceiptLine} → 合計 ${financeFootprint}`);

  if (financeFootprint > 0) {
    console.error("\n⚠️ 偵測到財務足跡，禁止硬刪，停止（未刪任何資料）。");
    process.exit(2);
  }
  console.log("財務足跡＝0：可安全硬刪。");

  console.log(`\n未觸碰：Household ${rr.householdId} / Members / 永久 WorshipRecord / 其他活動 / 正式財務資料。`);

  if (!commit) {
    console.log("\nDRY-RUN 結束，未寫入任何資料。確認上列筆數後加 --commit 執行。");
    return;
  }

  // ── COMMIT：單一交易 all-or-nothing，交易內重驗財務後才硬刪 ──
  const result = await prisma.$transaction(async (tx) => {
    const srcNow = inList(sourceIds);
    const gAlloc = srcNow ? Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${srcNow})`))[0]?.n ?? 0) : 0;
    const gReceipt = srcNow ? Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${srcNow})`))[0]?.n ?? 0) : 0;
    const gPaidItem = Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "ritual_registration_items" WHERE "ritualRecordId"=$1 AND "amountPaid" > 0`, RR_ID))[0]?.n ?? 0);
    const gPaidDetail = Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_details" WHERE "ritualRecordId"=$1 AND "amountPaid" > 0`, RR_ID))[0]?.n ?? 0);
    const gUsPay = detIn ? Number((await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detIn})`))[0]?.n ?? 0) : 0;
    const guard = gAlloc + gReceipt + gPaidItem + gPaidDetail + gUsPay;
    if (guard > 0) throw new Error(`交易內重驗發現財務足跡 ${guard} 筆，整批中止（未刪任何資料）。請重跑 dry-run。`);

    const del = async (sql: string, ...p: unknown[]) => Number(await tx.$executeRawUnsafe(sql, ...p)) || 0;
    const c: Record<string, number> = {};
    c.additional_print_items = await del(`DELETE FROM "additional_print_items" WHERE "ritualRecordId"=$1`, RR_ID);
    if (detIn) c.universal_salvation_payments = await del(`DELETE FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detIn})`);
    if (detIn) c.universal_salvation_entries = await del(`DELETE FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${detIn})`);
    c.ritual_registration_items = await del(`DELETE FROM "ritual_registration_items" WHERE "ritualRecordId"=$1`, RR_ID);
    c.ritual_participants = await del(`DELETE FROM "ritual_participants" WHERE "ritualRecordId"=$1`, RR_ID);
    c.universal_salvation_details = await del(`DELETE FROM "universal_salvation_details" WHERE "ritualRecordId"=$1`, RR_ID);
    c.ritual_records = await del(`DELETE FROM "ritual_records" WHERE "id"=$1`, RR_ID);
    return c;
  });

  console.log("\nCOMMIT 完成（硬刪除，單一交易）：");
  for (const [table, n] of Object.entries(result)) console.log(`  ${table}：${n}`);
  console.log("\n已完成單筆硬刪；未觸碰任何家戶／信眾／永久 WorshipRecord／其他活動／財務正式資料。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
