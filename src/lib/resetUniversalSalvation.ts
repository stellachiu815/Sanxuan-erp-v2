import { prisma } from "@/lib/prisma";

/**
 * V36.13 中元普渡「範圍化重置」——可由後端 API（瀏覽器觸發）呼叫，不需終端機。
 *
 * 沿用 scripts/resetUniversalSalvation115.ts 已驗證邏輯：
 *  - 範圍嚴格限定該年度普渡 TempleEvent 底下的 RitualRecord（以明確 id 清單刪除，絕不全表 DELETE）。
 *  - 財務保護：任一報名偵測到已收款（amountPaid>0／普渡收款分錄）或已確認收款（COMPLETED 分配／收據行）
 *    → 整筆跳過、不刪。
 *  - 硬刪（真正 DELETE，單一交易 all-or-nothing）→ 重匯乾淨、不會被軟刪 twin 復原。
 *  - 不動：Households／Members／永久 WorshipRecord／年度燈／其他活動／財務正式資料。
 *
 * commit=false（預設）＝Dry-Run：只回各表預計刪除筆數，不寫入。
 * commit=true ＝正式硬刪（呼叫端需已做權限與打字確認把關）。
 */

const ACTIVITY = "UNIVERSAL_SALVATION";

export type ResetUniversalSalvationReport = {
  ok: boolean;
  year: number;
  commit: boolean;
  templeEventId: string | null;
  targets: number;
  buckets: { draft: number; unpaid: number; collected: number; confirmed: number };
  deletable: number;
  counts: Record<string, number>;
  skippedHouseholds: { recordId: string; householdId: string; reason: "已收款" | "已確認收款" }[];
  outOfScope: number;
  error?: string;
};

function inList(ids: string[]): string | null {
  const safe = ids.filter((s) => !!s).map((s) => `'${s.replace(/'/g, "''")}'`);
  return safe.length ? safe.join(",") : null;
}
type Rec = { id: string; status: string; householdId: string; deletedAt: Date | null };
async function q<T>(sql: string): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql); }

export async function resetUniversalSalvation(year: number, opts: { commit: boolean }): Promise<ResetUniversalSalvationReport> {
  const commit = !!opts.commit;
  const base: ResetUniversalSalvationReport = {
    ok: false, year, commit, templeEventId: null, targets: 0,
    buckets: { draft: 0, unpaid: 0, collected: 0, confirmed: 0 }, deletable: 0,
    counts: {}, skippedHouseholds: [], outOfScope: 0,
  };

  const events = await q<{ id: string }>(`SELECT "id" FROM "temple_events" WHERE "activityType"='${ACTIVITY}' AND "year"=${year}`);
  if (events.length !== 1) return { ...base, error: `找不到唯一的 ${year} 普渡活動（找到 ${events.length} 筆），為安全起見中止。` };
  const eventId = events[0].id;
  base.templeEventId = eventId;
  const evL = eventId.replace(/'/g, "''");

  const targets = await q<Rec>(
    `SELECT "id","status","householdId","deletedAt" FROM "ritual_records"
     WHERE "activityType"='${ACTIVITY}' AND "year"=${year} AND "templeEventId"='${evL}'`);
  base.outOfScope = (await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "ritual_records" WHERE "activityType"='${ACTIVITY}' AND "year"=${year}
       AND ("templeEventId" IS NULL OR "templeEventId" <> '${evL}')`))[0]?.n ?? 0;
  base.targets = targets.length;
  if (targets.length === 0) return { ...base, ok: true };

  const recInList = inList(targets.map((r) => r.id))!;
  const rri = await q<{ id: string; ritualRecordId: string; amountPaid: string }>(
    `SELECT "id","ritualRecordId","amountPaid" FROM "ritual_registration_items" WHERE "ritualRecordId" IN (${recInList})`);
  const details = await q<{ id: string; ritualRecordId: string; amountPaid: string }>(
    `SELECT "id","ritualRecordId","amountPaid" FROM "universal_salvation_details" WHERE "ritualRecordId" IN (${recInList})`);
  const detailInList = inList(details.map((d) => d.id));
  const api = await q<{ id: string; ritualRecordId: string }>(
    `SELECT "id","ritualRecordId" FROM "additional_print_items" WHERE "ritualRecordId" IN (${recInList})`);
  const usPay = detailInList
    ? await q<{ did: string; n: number }>(`SELECT "universalSalvationDetailId" AS did, COUNT(*)::int AS n FROM "universal_salvation_payments" WHERE "universalSalvationDetailId" IN (${detailInList}) GROUP BY "universalSalvationDetailId"`)
    : [];

  const sourceToRec = new Map<string, string>();
  for (const r of rri) sourceToRec.set(r.id, r.ritualRecordId);
  for (const d of details) sourceToRec.set(d.id, d.ritualRecordId);
  for (const a of api) sourceToRec.set(a.id, a.ritualRecordId);
  const allSourceInList = inList([...sourceToRec.keys()]);
  const allocRows = allSourceInList
    ? await q<{ sid: string; st: string }>(`SELECT pa."sourceId" AS sid, pt."status" AS st FROM "payment_allocations" pa JOIN "payment_transactions" pt ON pt."id"=pa."paymentTransactionId" WHERE pa."sourceId" IN (${allSourceInList})`)
    : [];
  const receiptRows = allSourceInList
    ? await q<{ sid: string }>(`SELECT "sourceId" AS sid FROM "receipt_lines" WHERE "sourceId" IN (${allSourceInList})`)
    : [];

  const paidByRec = new Map<string, number>();
  const add = (rec: string, v: number) => paidByRec.set(rec, (paidByRec.get(rec) ?? 0) + v);
  for (const r of rri) add(r.ritualRecordId, Number(r.amountPaid) || 0);
  for (const d of details) add(d.ritualRecordId, Number(d.amountPaid) || 0);
  const usPayByRec = new Map<string, number>();
  const detailRecById = new Map(details.map((d) => [d.id, d.ritualRecordId]));
  for (const p of usPay) { const rec = detailRecById.get(p.did); if (rec) usPayByRec.set(rec, (usPayByRec.get(rec) ?? 0) + p.n); }
  const confirmedRecs = new Set<string>();
  for (const a of allocRows) if (a.st === "COMPLETED") { const rec = sourceToRec.get(a.sid); if (rec) confirmedRecs.add(rec); }
  for (const r of receiptRows) { const rec = sourceToRec.get(r.sid); if (rec) confirmedRecs.add(rec); }

  const bucket = { draft: [] as Rec[], unpaid: [] as Rec[], collected: [] as Rec[], confirmed: [] as Rec[] };
  for (const rec of targets) {
    if (confirmedRecs.has(rec.id)) bucket.confirmed.push(rec);
    else if ((paidByRec.get(rec.id) ?? 0) > 0 || (usPayByRec.get(rec.id) ?? 0) > 0) bucket.collected.push(rec);
    else if (rec.status === "DRAFT") bucket.draft.push(rec);
    else bucket.unpaid.push(rec);
  }
  base.buckets = { draft: bucket.draft.length, unpaid: bucket.unpaid.length, collected: bucket.collected.length, confirmed: bucket.confirmed.length };
  base.skippedHouseholds = [
    ...bucket.collected.map((r) => ({ recordId: r.id, householdId: r.householdId, reason: "已收款" as const })),
    ...bucket.confirmed.map((r) => ({ recordId: r.id, householdId: r.householdId, reason: "已確認收款" as const })),
  ];

  const delRecs = [...bucket.draft, ...bucket.unpaid];
  const delIds = delRecs.map((r) => r.id);
  base.deletable = delRecs.length;
  const delRecSet = new Set(delIds);
  const delRri = rri.filter((r) => delRecSet.has(r.ritualRecordId));
  const delDetails = details.filter((d) => delRecSet.has(d.ritualRecordId));
  const delDetailIds = delDetails.map((d) => d.id);
  const delApi = api.filter((a) => delRecSet.has(a.ritualRecordId));

  const importBatches = await q<{ id: string }>(
    `SELECT "id" FROM "purification_import_batches" WHERE "year"=${year} AND ("templeEventId"='${evL}' OR "templeEventId" IS NULL)`);
  const batchIds = importBatches.map((b) => b.id);
  const importRowsCount = inList(batchIds)
    ? (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "purification_import_rows" WHERE "batchId" IN (${inList(batchIds)})`))[0]?.n ?? 0
    : 0;
  const entriesCount = inList(delDetailIds)
    ? (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "universal_salvation_entries" WHERE "universalSalvationId" IN (${inList(delDetailIds)})`))[0]?.n ?? 0
    : 0;

  base.counts = {
    ritual_records: delRecs.length,
    ritual_registration_items: delRri.length,
    universal_salvation_details: delDetails.length,
    universal_salvation_entries: entriesCount,
    additional_print_items: delApi.length,
    purification_import_batches: importBatches.length,
    purification_import_rows: importRowsCount,
  };

  if (!commit) return { ...base, ok: true };
  if (delIds.length === 0 && batchIds.length === 0) return { ...base, ok: true };

  const result = await prisma.$transaction(async (tx) => {
    // 交易內重驗財務足跡（避免 dry-run 後才發生收款的競態）。
    const srcNow = inList([...delRri.map((r) => r.id), ...delDetails.map((d) => d.id), ...delApi.map((a) => a.id)]);
    if (srcNow) {
      const allocNow = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${srcNow})`);
      const rlNow = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${srcNow})`);
      const paidNow = await tx.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "ritual_registration_items" WHERE "ritualRecordId" IN (${inList(delIds)}) AND "amountPaid" > 0`);
      if ((allocNow[0]?.n ?? 0) + (rlNow[0]?.n ?? 0) + (paidNow[0]?.n ?? 0) > 0) throw new Error("交易內重驗發現財務足跡，整批中止（未刪任何資料）。");
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

  return { ...base, ok: true, counts: result };
}
