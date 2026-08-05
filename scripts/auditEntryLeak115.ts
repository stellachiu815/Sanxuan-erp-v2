/**
 * V34.3A：追查「已封存牌位為何仍進入 115 列印清單」（唯讀，只 SELECT，不改任何資料）。
 *
 * 目標 UniversalSalvationEntry.id（可用 --id= 覆寫），預設本次個案：
 *   cmsdcny9m002vec1tr7mztjht（陳婷疼乙位正魂）
 *
 *   npx tsx scripts/auditEntryLeak115.ts
 */
import { prisma } from "../src/lib/prisma";

const DEFAULT_ID = "cmsdcny9m002vec1tr7mztjht";
const YEAR = 115;
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  const idArg = process.argv.find((a) => a.startsWith("--id="));
  const EID = idArg ? idArg.slice(5) : DEFAULT_ID;
  console.log(`=== V34.3A 封存牌位漏排查（唯讀）===\n目標 entry：${EID}\n`);

  // 4) UniversalSalvationEntry 本體
  const entry = (await q<{ id: string; displayName: string; category: string; deletedAt: Date | null; deletedByName: string | null; createdAt: Date; worshipRecordId: string | null; universalSalvationId: string }>(
    `SELECT "id","displayName","category"::text AS category,"deletedAt","deletedByName","createdAt","worshipRecordId","universalSalvationId"
     FROM "universal_salvation_entries" WHERE "id"=$1`, EID))[0];
  if (!entry) { console.error("找不到該 entry，停止。"); process.exit(1); }
  console.log(`4) Entry：${entry.displayName}｜${entry.category}｜deletedAt=${entry.deletedAt ? new Date(entry.deletedAt).toISOString() : "null（未封存）"}${entry.deletedByName ? `（by ${entry.deletedByName}）` : ""}｜建立 ${new Date(entry.createdAt).toISOString()}`);

  // 1) 關聯 WorshipRecord
  if (entry.worshipRecordId) {
    const wr = (await q<{ id: string; type: string; displayName: string; deletedAt: Date | null; householdId: string }>(
      `SELECT "id","type"::text AS type,"displayName","deletedAt","householdId" FROM "worship_records" WHERE "id"=$1`, entry.worshipRecordId))[0];
    console.log(`1) WorshipRecord：${wr ? `${wr.id}｜${wr.type}｜${wr.displayName}｜家戶 ${wr.householdId}｜deletedAt=${wr.deletedAt ? new Date(wr.deletedAt).toISOString() : "null"}` : "（worshipRecordId 指向不存在）"}`);
  } else {
    console.log(`1) WorshipRecord：無（entry.worshipRecordId 為 null——非同步自永久名單）`);
  }

  // 2) 關聯 RitualRecord（經 UniversalSalvationDetail）
  const rr = (await q<{ did: string; rrid: string; status: string; deletedAt: Date | null; year: number; activityType: string; templeEventId: string | null; householdId: string }>(
    `SELECT usd."id" AS did, rr."id" AS rrid, rr."status"::text AS status, rr."deletedAt", rr."year", rr."activityType"::text AS "activityType", rr."templeEventId", rr."householdId"
     FROM "universal_salvation_details" usd JOIN "ritual_records" rr ON rr."id"=usd."ritualRecordId" WHERE usd."id"=$1`, entry.universalSalvationId))[0];
  console.log(`2) RitualRecord：${rr ? `${rr.rrid}｜status=${rr.status}｜${rr.activityType}/${rr.year}｜templeEventId=${rr.templeEventId ?? "NULL"}｜家戶 ${rr.householdId}｜deletedAt=${rr.deletedAt ? new Date(rr.deletedAt).toISOString() : "null"}` : "（查無）"}`);

  // 3) 關聯 RitualRegistrationItem
  const rri = await q<{ id: string; status: string; deletedAt: Date | null; amountPaid: string }>(
    `SELECT "id","status"::text AS status,"deletedAt","amountPaid" FROM "ritual_registration_items" WHERE "universalSalvationEntryId"=$1`, EID);
  console.log(`3) RitualRegistrationItem：${rri.length} 筆` + rri.map((r) => `\n     - ${r.id}｜status=${r.status}｜deletedAt=${r.deletedAt ? new Date(r.deletedAt).toISOString() : "null"}｜amountPaid=${r.amountPaid}`).join(""));

  // 5) 關聯 AdditionalPrintItem
  const api = await q<{ id: string; deletedAt: Date | null; status: string; isExtra: boolean; itemType: string; printCount: number; createdAt: Date; ritualRecordId: string; activityId: string | null; usesSourceName: boolean }>(
    `SELECT "id","deletedAt","status"::text AS status,"isExtra","itemType"::text AS "itemType","printCount","createdAt","ritualRecordId","activityId","usesSourceName"
     FROM "additional_print_items" WHERE "sourceEntryId"=$1`, EID);
  console.log(`5) AdditionalPrintItem：${api.length} 筆` + api.map((a) => `\n     - ${a.id}｜${a.itemType}｜status=${a.status}｜isExtra=${a.isExtra}｜printCount=${a.printCount}｜deletedAt=${a.deletedAt ? new Date(a.deletedAt).toISOString() : "null（未封存）"}｜ritualRecordId=${a.ritualRecordId}`).join(""));

  // 6) 建立來源（RecordVersion）
  const rv = await q<{ action: string; operatorName: string | null; changeNote: string | null; createdAt: Date }>(
    `SELECT "action"::text AS action,"operatorName","changeNote","createdAt" FROM "record_versions" WHERE "entityType"='UniversalSalvationEntry' AND "entityId"=$1 ORDER BY "createdAt" ASC`, EID);
  console.log(`6) 建立／異動來源（RecordVersion ${rv.length} 筆）：` + (rv.length ? rv.map((v) => `\n     - ${new Date(v.createdAt).toISOString()}｜${v.action}｜${v.operatorName ?? "?"}｜${(v.changeNote ?? "").slice(0, 120)}`).join("") : "（無版本紀錄）"));

  // 7) 重現 listPrintItemsForPrintCenter 的過濾：為何仍被查出
  const leakByThisEntry = api.some((a) => a.deletedAt == null) && rr && rr.deletedAt == null && rr.year === YEAR && rr.activityType === "UNIVERSAL_SALVATION" && entry.deletedAt != null;
  console.log(`\n7) 是否會被 listPrintItemsForPrintCenter 查出：${leakByThisEntry ? "會（洩漏）" : "不會"}`);
  console.log(`   判定：查詢只過濾 AdditionalPrintItem.deletedAt IS NULL 與 ritualRecord.deletedAt IS NULL，`);
  console.log(`         但抓 source entry 時「沒有」加 deletedAt IS NULL → 封存的 entry 只要其列印物件未封存就會漏進清單。`);

  // 10) 全年度所有「同類洩漏」清單：api 未封存、ritualRecord 未封存、但 entry 已封存
  const leaks = await q<{ apiid: string; eid: string; displayName: string; category: string; itemType: string; deletedAt: Date | null }>(
    `SELECT api."id" AS apiid, e."id" AS eid, e."displayName", e."category"::text AS category, api."itemType"::text AS "itemType", e."deletedAt"
     FROM "additional_print_items" api
     JOIN "universal_salvation_entries" e ON e."id"=api."sourceEntryId"
     JOIN "ritual_records" rr ON rr."id"=api."ritualRecordId"
     WHERE api."deletedAt" IS NULL AND rr."deletedAt" IS NULL AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
       AND e."deletedAt" IS NOT NULL
     ORDER BY e."category", e."displayName"`);
  console.log(`\n10) 全 ${YEAR} 年度「已封存 entry 但列印物件未封存、仍會漏進列印查詢」共 ${leaks.length} 筆：`);
  for (const l of leaks) console.log(`     - entry ${l.eid}｜${l.category}｜${l.displayName}｜${l.itemType}｜api ${l.apiid}`);
  console.log(`\n   → 正確「應有筆數」= 目前 print 查詢筆數 − 上列洩漏筆數（依 batch 分別扣除）。`);
  console.log(`\n（唯讀追查結束，未修改任何資料。）`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
