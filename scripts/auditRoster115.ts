/**
 * V36.3A：追查「US_ANCESTOR/115 總名單 0 筆」真正根因（唯讀，只 SELECT）。
 *
 * buildItemRoster 的硬條件：RRI.status=CONFIRMED、其 RitualRecord.status=CONFIRMED、
 *   registrationItemType.key 相符、year 相符、deletedAt 皆 null（無 activityType／templeEventId 過濾）。
 * 本腳本統計 115 普渡各 key 的 (RRI.status × RitualRecord.status) 分佈，並定位陳永成。
 *
 *   npx tsx scripts/auditRoster115.ts
 */
import { prisma } from "../src/lib/prisma";
const YEAR = 115;
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  console.log(`=== V36.3A 115 普渡總名單 0 筆追查（唯讀）===\n`);

  // 1) 各 key 的 RRI.status × RitualRecord.status 分佈（115 普渡、未刪除）。
  const dist = await q<{ key: string; ristatus: string; rrstatus: string; n: number }>(
    `SELECT rit."key" AS key, rri."status"::text AS ristatus, rr."status"::text AS rrstatus, COUNT(*)::int AS n
     FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id"=rri."registrationItemTypeId"
     JOIN "ritual_records" rr ON rr."id"=rri."ritualRecordId"
     WHERE rri."deletedAt" IS NULL AND rr."deletedAt" IS NULL
       AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
     GROUP BY rit."key", rri."status", rr."status"
     ORDER BY rit."key", rri."status", rr."status"`);
  console.log(`── 115 普渡 RRI 分佈（key｜RRI狀態｜RitualRecord狀態｜筆數）──`);
  for (const d of dist) console.log(`  ${d.key} | RRI=${d.ristatus} | RR=${d.rrstatus} | ${d.n}`);

  // 2) 各 key「符合總名單條件（雙 CONFIRMED）」的筆數 = 總名單實際會顯示的數。
  const confirmed = await q<{ key: string; n: number }>(
    `SELECT rit."key" AS key, COUNT(*)::int AS n
     FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id"=rri."registrationItemTypeId"
     JOIN "ritual_records" rr ON rr."id"=rri."ritualRecordId"
     WHERE rri."deletedAt" IS NULL AND rr."deletedAt" IS NULL
       AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
       AND rri."status"::text='CONFIRMED' AND rr."status"::text='CONFIRMED'
     GROUP BY rit."key" ORDER BY rit."key"`);
  console.log(`\n── 各 key「雙 CONFIRMED」筆數（＝總名單實際顯示數）──`);
  const keys = ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN", "US_POCKET_EXTRA", "US_RICE", "US_SPONSOR", "US_SPONSOR_DONATION"];
  for (const k of keys) console.log(`  ${k}：${confirmed.find((c) => c.key === k)?.n ?? 0}`);

  // 3) 定位陳永成：牌位主文或成員姓名含「陳永成」。
  const chen = await q<{ rriid: string; key: string; ristatus: string; rrstatus: string; disp: string | null; rrid: string; deleted: Date | null }>(
    `SELECT rri."id" AS rriid, rit."key" AS key, rri."status"::text AS ristatus, rr."status"::text AS rrstatus,
            e."displayName" AS disp, rr."id" AS rrid, rri."deletedAt" AS deleted
     FROM "ritual_registration_items" rri
     JOIN "registration_item_types" rit ON rit."id"=rri."registrationItemTypeId"
     JOIN "ritual_records" rr ON rr."id"=rri."ritualRecordId"
     LEFT JOIN "universal_salvation_entries" e ON e."id"=rri."universalSalvationEntryId"
     WHERE rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
       AND (e."displayName" LIKE '%陳永成%')`);
  console.log(`\n── 陳永成相關報名項目（${chen.length} 筆）──`);
  for (const c of chen) {
    const excludedBy: string[] = [];
    if (c.deleted) excludedBy.push("RRI 已刪除");
    if (c.ristatus !== "CONFIRMED") excludedBy.push(`RRI 狀態=${c.ristatus}（非 CONFIRMED）`);
    if (c.rrstatus !== "CONFIRMED") excludedBy.push(`RitualRecord 狀態=${c.rrstatus}（非 CONFIRMED）`);
    console.log(`  ${c.key}｜${c.disp}｜RRI=${c.ristatus}｜RR=${c.rrstatus}｜排除於：${excludedBy.join("、") || "不排除（會顯示）"}`);
  }
  console.log(`\n（唯讀追查結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
