/**
 * V35：115 年普渡「正式資料重置」一次性工具（dry-run 預設；--commit 才真正刪除）。
 *
 * 目標：只清除「民國 115 年普渡」相關報名資料，讓報名／匯入可乾淨重來。
 *   範圍錨點＝TempleEvent(activityType='UNIVERSAL_SALVATION', year=115)。
 *
 * 安全規格（依使用者指令）：
 *   1. 硬刪除（真正 DELETE），但一律以「115 普渡 TempleEvent」為範圍，且以明確 id 清單刪除。
 *   2. 絕不使用 TRUNCATE 或全表 DELETE（每一句 DELETE 都帶 WHERE ... IN (明確 id)）。
 *   3. 財務保護（選項一）：只刪「草稿／未收款」的報名；任一報名只要偵測到
 *      已收款（amountPaid>0 或有普渡收款分錄）或已確認收款（有 COMPLETED 收款交易分配／收據行）
 *      → 整筆報名跳過，不刪，並在報告中列出。
 *   4. 不刪：Households、Members、永久 WorshipRecord、年度燈／全家燈、其他活動、財務正式資料
 *      （payment_transactions / payment_allocations / receipts / receipt_lines / manual_receivables / finance_records）。
 *   5. Dry-run 先跑，列出各表預計刪除筆數與四類統計；使用者確認後才 --commit。
 *
 * 刪除範圍（僅限「可刪報名」集合，硬刪、單一交易 all-or-nothing）：
 *   additional_print_items / universal_salvation_payments / universal_salvation_entries /
 *   ritual_registration_items / ritual_participants / universal_salvation_details / ritual_records
 *   ＋ 115 普渡匯入草稿：purification_import_rows / purification_import_batches
 *
 *   # 1) 預覽（唯讀，務必先跑）
 *   npx tsx scripts/resetUniversalSalvation115.ts
 *   # 2) 確認無誤後正式執行（硬刪、單一交易）
 *   npx tsx scripts/resetUniversalSalvation115.ts --commit
 */
import { prisma } from "../src/lib/prisma";

const YEAR = 115;
const ACTIVITY = "UNIVERSAL_SALVATION";

/** 安全的 IN 清單（id 為 cuid；仍逐一跳脫單引號）。空清單回傳 null（呼叫端略過該查詢）。 */
function inList(ids: string[]): string | null {
  const safe = ids.filter((s) => !!s).map((s) => `'${s.replace(/'/g, "''")}'`);
  return safe.length ? safe.join(",") : null;
}

type Rec = { id: string; status: string; householdId: string; deletedAt: Date | null };

async function q<T>(sql: string): Promise<T[]> {
  return prisma.$queryRawUnsafe<T[]>(sql);
}

async function main() {
  const commit = process.argv.includes("--commit");

  console.log("=== V35 115 年普渡正式資料重置 ===");
  console.log(`模式：${commit ? "COMMIT（會硬刪除）" : "DRY-RUN（唯讀，不寫入）"}`);

  // 0) 範圍錨點：115 普渡 TempleEvent。找不到就停止（不做任何猜測範圍）。
  const events = await q<{ id: string; name: string; status: string }>(
    `SELECT "id","name","status" FROM "temple_events" WHERE "activityType"='${ACTIVITY}' AND "year"=${YEAR}`
  );
  if (events.length === 0) {
    console.error(`找不到 ${YEAR} 年普渡 TempleEvent（activityType=${ACTIVITY}, year=${YEAR}），停止。`);
    process.exit(1);
  }
  if (events.length > 1) {
    console.error(`偵測到多筆 ${YEAR} 普渡 TempleEvent（應唯一），為安全起見停止：`, events.map((e) => e.id));
    process.exit(1);
  }
  const eventId = events[0].id;
  console.log(`範圍 TempleEvent：${eventId}｜${events[0].name}｜status=${events[0].status}`);

  // 1) 目標報名：嚴格限定本活動 TempleEvent 底下的普渡 RitualRecord（含軟刪，硬重置一併清）。
  const targets = await q<Rec>(
    `SELECT "id","status","householdId","deletedAt" FROM "ritual_records"
     WHERE "activityType"='${ACTIVITY}' AND "year"=${YEAR} AND "templeEventId"='${eventId.replace(/'/g, "''")}'`
  );

  // 範圍外提醒（不刪）：同年同活動但 templeEventId 為空或不同的舊資料。
  const outOfScope = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ritual_records"
     WHERE "activityType"='${ACTIVITY}' AND "year"=${YEAR}
       AND ("templeEventId" IS NULL OR "templeEventId" <> '${eventId.replace(/'/g, "''")}')`
  );

  if (targets.length === 0) {
    console.log("本活動範圍內沒有任何普渡報名資料。");
    console.log(`（範圍外、未處理的 ${YEAR} 普渡報名：${outOfScope[0]?.n ?? 0} 筆——不在本工具範圍。）`);
    return;
  }
  const recIds = targets.map((r) => r.id);
  const recInList = inList(recIds)!;

  // 2) 各報名的子資料（供分類與刪除計數）。
  const rri = await q<{ id: string; ritualRecordId: string; amountPaid: string }>(
    `SELECT "id","ritualRecordId","amountPaid" FROM "ritual_registration_items" WHERE "ritualRecordId" IN (${recInList})`
  );
  const details = await q<{ id: string; ritualRecordId: string; amountPaid: string }>(
    `SELECT "id","ritualRecordId","amountPaid" FROM "universal_salvation_details" WHERE "ritualRecordId" IN (${recInList})`
  );
  const detailIds = details.map((d) => d.id);
  const detailInList = inList(detailIds);
  const api = await q<{ id: string; ritualRecordId: string }>(
    `SELECT "id","ritualRecordId" FROM "additional_print_items" WHERE "ritualRecordId" IN (${recInList})`
  );
  const usPay = detailInList
    ? await q<{ did: string; n: number }>(
        `SELECT "universalSalvationDetailId" AS did, COUNT(*)::int AS n
         FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detailInList}) GROUP BY "universalSalvationDetailId"`
      )
    : [];

  // 3) 財務關聯偵測（多型 sourceId：牌位/白米＝rri.id、贊普＝detail.id、寶袋＝api.id）。
  const sourceToRec = new Map<string, string>();
  for (const r of rri) sourceToRec.set(r.id, r.ritualRecordId);
  for (const d of details) sourceToRec.set(d.id, d.ritualRecordId);
  for (const a of api) sourceToRec.set(a.id, a.ritualRecordId);
  const allSourceInList = inList([...sourceToRec.keys()]);

  const allocRows = allSourceInList
    ? await q<{ sid: string; st: string }>(
        `SELECT pa."sourceId" AS sid, pt."status" AS st
         FROM "payment_allocations" pa
         JOIN "payment_transactions" pt ON pt."id" = pa."paymentTransactionId"
         WHERE pa."sourceId" IN (${allSourceInList})`
      )
    : [];
  const receiptRows = allSourceInList
    ? await q<{ sid: string }>(`SELECT "sourceId" AS sid FROM "receipt_lines" WHERE "sourceId" IN (${allSourceInList})`)
    : [];

  // 每筆報名的財務足跡彙整。
  const paidAmountByRec = new Map<string, number>();
  const add = (rec: string, v: number) => paidAmountByRec.set(rec, (paidAmountByRec.get(rec) ?? 0) + v);
  for (const r of rri) add(r.ritualRecordId, Number(r.amountPaid) || 0);
  for (const d of details) add(d.ritualRecordId, Number(d.amountPaid) || 0);
  const usPayByRec = new Map<string, number>();
  const detailRecById = new Map(details.map((d) => [d.id, d.ritualRecordId]));
  for (const p of usPay) {
    const rec = detailRecById.get(p.did);
    if (rec) usPayByRec.set(rec, (usPayByRec.get(rec) ?? 0) + p.n);
  }
  const confirmedRecs = new Set<string>();
  for (const a of allocRows) if (a.st === "COMPLETED") { const rec = sourceToRec.get(a.sid); if (rec) confirmedRecs.add(rec); }
  for (const r of receiptRows) { const rec = sourceToRec.get(r.sid); if (rec) confirmedRecs.add(rec); }

  // 4) 分類：草稿／未收款（可刪）；已收款／已確認收款（跳過）。
  const bucket = { draft: [] as Rec[], unpaid: [] as Rec[], collected: [] as Rec[], confirmed: [] as Rec[] };
  for (const rec of targets) {
    const hasConfirmed = confirmedRecs.has(rec.id);
    const hasCollection = (paidAmountByRec.get(rec.id) ?? 0) > 0 || (usPayByRec.get(rec.id) ?? 0) > 0;
    if (hasConfirmed) bucket.confirmed.push(rec);
    else if (hasCollection) bucket.collected.push(rec);
    else if (rec.status === "DRAFT") bucket.draft.push(rec);
    else bucket.unpaid.push(rec);
  }
  const delRecs = [...bucket.draft, ...bucket.unpaid];
  const delIds = delRecs.map((r) => r.id);
  const skipRecs = [...bucket.collected, ...bucket.confirmed];

  // 5) 可刪集合對應的各表筆數（僅計 delIds 範圍）。
  const delRecSet = new Set(delIds);
  const delRri = rri.filter((r) => delRecSet.has(r.ritualRecordId));
  const delDetails = details.filter((d) => delRecSet.has(d.ritualRecordId));
  const delDetailIds = delDetails.map((d) => d.id);
  const delApi = api.filter((a) => delRecSet.has(a.ritualRecordId));
  const delEntriesRows = inList(delDetailIds)
    ? await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${inList(delDetailIds)})`)
    : [{ n: 0 }];
  const delParticipantsRows = inList(delIds)
    ? await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "ritual_participants" WHERE "ritualRecordId" IN (${inList(delIds)})`)
    : [{ n: 0 }];
  const delUsPayRows = inList(delDetailIds)
    ? await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${inList(delDetailIds)})`)
    : [{ n: 0 }];

  // 6) 115 普渡匯入草稿（PENDING/CONFIRMED 皆屬草稿記錄，無財務；一併清以利乾淨重來）。
  const importBatches = await q<{ id: string }>(
    `SELECT "id" FROM "purification_import_batches" WHERE "year"=${YEAR} AND ("templeEventId"='${eventId.replace(/'/g, "''")}' OR "templeEventId" IS NULL)`
  );
  const batchIds = importBatches.map((b) => b.id);
  const importRowsCount = inList(batchIds)
    ? (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "purification_import_rows" WHERE "batchId" IN (${inList(batchIds)})`))[0]?.n ?? 0
    : 0;

  // ── 報告 ─────────────────────────────────────────────
  console.log(`\n目標普渡報名（本活動範圍內）：${targets.length} 筆`);
  console.log("分類（財務保護＝選項一）：");
  console.log(`  草稿（將刪）：       ${bucket.draft.length}`);
  console.log(`  未收款（將刪）：     ${bucket.unpaid.length}`);
  console.log(`  已收款（將跳過）：   ${bucket.collected.length}`);
  console.log(`  已確認收款（將跳過）：${bucket.confirmed.length}`);
  console.log(`  → 實際可刪報名：     ${delRecs.length} 筆`);

  console.log("\n各表預計硬刪除筆數（僅限可刪報名範圍）：");
  console.log(`  ritual_records            ：${delRecs.length}`);
  console.log(`  ritual_registration_items ：${delRri.length}`);
  console.log(`  universal_salvation_details：${delDetails.length}`);
  console.log(`  universal_salvation_entries：${delEntriesRows[0]?.n ?? 0}`);
  console.log(`  universal_salvation_payments：${delUsPayRows[0]?.n ?? 0}（可刪範圍理應為 0）`);
  console.log(`  ritual_participants       ：${delParticipantsRows[0]?.n ?? 0}`);
  console.log(`  additional_print_items    ：${delApi.length}`);
  console.log("115 普渡匯入草稿：");
  console.log(`  purification_import_batches：${importBatches.length}`);
  console.log(`  purification_import_rows   ：${importRowsCount}`);

  if (skipRecs.length > 0) {
    console.log("\n跳過（有收款／已確認收款，一律保留，含其財務）：");
    for (const r of bucket.collected) console.log(`  - [已收款] RitualRecord ${r.id}（家戶 ${r.householdId}）`);
    for (const r of bucket.confirmed) console.log(`  - [已確認收款] RitualRecord ${r.id}（家戶 ${r.householdId}）`);
  }
  console.log(`\n未觸碰：Households / Members / 永久 WorshipRecord / 年度燈・全家燈 / 其他活動 / 財務正式資料。`);
  console.log(`（範圍外、未處理的 ${YEAR} 普渡報名（templeEventId 空或不同）：${outOfScope[0]?.n ?? 0} 筆——不在本工具範圍，未刪。）`);

  if (!commit) {
    console.log("\nDRY-RUN 結束，未寫入任何資料。確認上列數字無誤後，加 --commit 執行。");
    return;
  }

  if (delIds.length === 0 && batchIds.length === 0) {
    console.log("\n沒有可刪除的資料，結束。");
    return;
  }

  // ── COMMIT：單一交易 all-or-nothing，交易內重驗財務後才硬刪 ──
  const result = await prisma.$transaction(async (tx) => {
    // 交易內重驗：可刪報名集合此刻仍不得有任何財務足跡（避免 dry-run 後才發生收款的競態）。
    const srcNow = inList([
      ...delRri.map((r) => r.id),
      ...delDetails.map((d) => d.id),
      ...delApi.map((a) => a.id),
    ]);
    if (srcNow) {
      const allocNow = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${srcNow})`
      );
      const rlNow = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${srcNow})`
      );
      const paidNow = await tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT COUNT(*)::int AS n FROM "ritual_registration_items" WHERE "ritualRecordId" IN (${inList(delIds)}) AND "amountPaid" > 0`
      );
      const guard = (allocNow[0]?.n ?? 0) + (rlNow[0]?.n ?? 0) + (paidNow[0]?.n ?? 0);
      if (guard > 0) throw new Error(`交易內重驗發現財務足跡 ${guard} 筆，整批中止（未刪任何資料）。請重跑 dry-run。`);
    }

    const del = async (sql: string) => Number(await tx.$executeRawUnsafe(sql)) || 0;
    const counts: Record<string, number> = {};
    const recL = inList(delIds);
    const detL = inList(delDetailIds);
    if (recL) {
      counts.additional_print_items = await del(`DELETE FROM "additional_print_items" WHERE "ritualRecordId" IN (${recL})`);
      if (detL) counts.universal_salvation_payments = await del(`DELETE FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detL})`);
      if (detL) counts.universal_salvation_entries = await del(`DELETE FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${detL})`);
      counts.ritual_registration_items = await del(`DELETE FROM "ritual_registration_items" WHERE "ritualRecordId" IN (${recL})`);
      counts.ritual_participants = await del(`DELETE FROM "ritual_participants" WHERE "ritualRecordId" IN (${recL})`);
      counts.universal_salvation_details = await del(`DELETE FROM "universal_salvation_details" WHERE "ritualRecordId" IN (${recL})`);
      counts.ritual_records = await del(`DELETE FROM "ritual_records" WHERE "id" IN (${recL})`);
    }
    const batchL = inList(batchIds);
    if (batchL) {
      counts.purification_import_rows = await del(`DELETE FROM "purification_import_rows" WHERE "batchId" IN (${batchL})`);
      counts.purification_import_batches = await del(`DELETE FROM "purification_import_batches" WHERE "id" IN (${batchL})`);
    }
    return counts;
  });

  console.log("\nCOMMIT 完成（硬刪除，單一交易）：");
  for (const [table, n] of Object.entries(result)) console.log(`  ${table}：${n}`);
  console.log(`\n已保留跳過的 ${skipRecs.length} 筆（有收款／已確認收款）與所有財務正式資料。`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
