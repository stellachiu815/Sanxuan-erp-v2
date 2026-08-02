/**
 * V30.4 中元普渡「樣本」唯讀診斷（Q1+Q2+Q3 合併）。
 *
 * ⚠️ 完全唯讀：只 SELECT、只印出結果，不寫入、不更新、不刪除、不 backfill。
 *
 * 執行（Mac、專案根目錄；讀 .env 的 DATABASE_URL）：
 *   npx tsx scripts/universalSalvationSampleDiagnostic.ts [民國年 預設115] [信眾姓名 預設周財寶]
 *
 * 輸出：
 *   1) 指定信眾（預設周財寶）的 record / item / status / 金額 / 來源。
 *   2) 各一筆停在 DRAFT 的 超拔祖先 / 乙位正魂 / 累世冤親債主 樣本。
 *   3) 孤兒冤親（有 UniversalSalvationEntry、無對應未刪 RitualRegistrationItem）的
 *      household / registrationSource / 建立 changeNote。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

function fmt(v: unknown): string {
  if (v == null) return "—";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

async function main() {
  const year = Number(process.argv[2] ?? 115);
  const memberName = process.argv[3] ?? "周財寶";
  console.log(`=== V30.4 中元普渡樣本診斷（唯讀）year=${year} 信眾=「${memberName}」 ===\n`);

  // ── 1) 指定信眾的 record + items ───────────────────────────────
  type Q1 = {
    record_id: string; record_status: string; registrationSource: string | null;
    record_created: Date; record_updated: Date;
    key: string | null; item_id: string | null; item_status: string | null;
    quantity: number | null; amountDue: string | null; amountPaid: string | null; amountUnpaid: string | null;
    item_created: Date | null; item_updated: Date | null; has_entry: boolean | null;
  };
  const q1 = await prisma.$queryRaw<Q1[]>`
    SELECT rr."id" AS record_id, rr."status" AS record_status, rr."registrationSource",
           rr."createdAt" AS record_created, rr."updatedAt" AS record_updated,
           rit."key", rri."id" AS item_id, rri."status" AS item_status, rri."quantity",
           rri."amountDue", rri."amountPaid", rri."amountUnpaid",
           rri."createdAt" AS item_created, rri."updatedAt" AS item_updated,
           (rri."universalSalvationEntryId" IS NOT NULL) AS has_entry
    FROM "ritual_records" rr
    JOIN "members" m ON m."householdId" = rr."householdId" AND m."name" = ${memberName} AND m."deletedAt" IS NULL
    LEFT JOIN "ritual_registration_items" rri ON rri."ritualRecordId" = rr."id" AND rri."deletedAt" IS NULL
    LEFT JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL
    ORDER BY rit."sortOrder" NULLS LAST, rri."createdAt"
  `;
  console.log(`【1）「${memberName}」的 record / item】`);
  if (q1.length === 0) {
    console.log("  （查無此信眾本年度中元普渡 record；請確認姓名或年度）");
  } else {
    const first = q1[0];
    console.log(`  record_id=${first.record_id}  record.status=${first.record_status}  來源=${fmt(first.registrationSource)}  建立=${fmt(first.record_created)}  更新=${fmt(first.record_updated)}`);
    const items = q1.filter((r) => r.item_id);
    if (items.length === 0) {
      console.log("  ▸ 這筆 record 底下沒有任何 RitualRegistrationItem（record 有、明細空）。");
    } else {
      for (const r of items) {
        console.log(
          `  ▸ ${r.key}  item.status=${r.item_status}  數量=${fmt(r.quantity)}  ` +
            `應收=${fmt(r.amountDue)} 已收=${fmt(r.amountPaid)} 未收=${fmt(r.amountUnpaid)}  ` +
            `有牌位entry=${r.has_entry ? "是" : "否"}  item建立=${fmt(r.item_created)} 更新=${fmt(r.item_updated)}`
        );
      }
    }
  }

  // ── 2) 各一筆 DRAFT 樣本：祖先 / 乙位 / 冤親 ────────────────────
  type Q2 = {
    key: string; record_status: string; item_status: string; registrationSource: string | null;
    household: string; record_created: Date; item_created: Date; item_updated: Date;
    amountPaid: string; amountUnpaid: string; has_entry: boolean;
  };
  console.log(`\n【2）DRAFT 樣本（各項目一筆）】`);
  for (const key of ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN"]) {
    const rows = await prisma.$queryRaw<Q2[]>`
      SELECT rit."key", rr."status" AS record_status, rri."status" AS item_status, rr."registrationSource",
             h."name" AS household, rr."createdAt" AS record_created, rri."createdAt" AS item_created,
             rri."updatedAt" AS item_updated, rri."amountPaid", rri."amountUnpaid",
             (rri."universalSalvationEntryId" IS NOT NULL) AS has_entry
      FROM "ritual_registration_items" rri
      JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
      JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
      JOIN "households" h ON h."id" = rr."householdId"
      WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year}
        AND rri."deletedAt" IS NULL AND rri."status" = 'DRAFT' AND rit."key" = ${key}
      ORDER BY rri."createdAt"
      LIMIT 1
    `;
    const label = { US_ANCESTOR: "超拔祖先", US_ZHENGHUN: "乙位正魂", US_YUANQIN: "累世冤親債主" }[key];
    if (rows.length === 0) {
      console.log(`  ▸ ${label}（${key}）：查無 DRAFT 樣本`);
    } else {
      const r = rows[0];
      console.log(
        `  ▸ ${label}（${key}）：record.status=${r.record_status} item.status=${r.item_status} 來源=${fmt(r.registrationSource)} ` +
          `家戶=${r.household} 有牌位entry=${r.has_entry ? "是" : "否"} 已收=${fmt(r.amountPaid)} 未收=${fmt(r.amountUnpaid)} ` +
          `record建立=${fmt(r.record_created)} item建立=${fmt(r.item_created)} 更新=${fmt(r.item_updated)}`
      );
    }
  }

  // ── 3) 孤兒冤親（entry 無對應 item）來源 ───────────────────────
  type Q3 = {
    id: string; displayName: string; createdAt: Date;
    registrationSource: string | null; household: string; changeNote: string | null;
  };
  const q3 = await prisma.$queryRaw<Q3[]>`
    SELECT e."id", e."displayName", e."createdAt",
           rr."registrationSource", h."name" AS household, rv."changeNote"
    FROM "universal_salvation_entries" e
    JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
    JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
    JOIN "households" h ON h."id" = rr."householdId"
    LEFT JOIN "record_versions" rv ON rv."entityType" = 'UniversalSalvationEntry'
         AND rv."entityId" = e."id" AND rv."action" = 'CREATE'
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year}
      AND e."deletedAt" IS NULL AND e."category" = 'DEBT_CREDITOR'
      AND NOT EXISTS (
        SELECT 1 FROM "ritual_registration_items" x
        WHERE x."universalSalvationEntryId" = e."id" AND x."deletedAt" IS NULL
      )
    ORDER BY e."createdAt"
  `;
  console.log(`\n【3）孤兒冤親（有 entry、無 item）共 ${q3.length} 筆】`);
  if (q3.length === 0) {
    console.log("  （無）");
  } else {
    for (const r of q3) {
      console.log(
        `  ▸ ${r.displayName}｜家戶=${r.household}｜來源=${fmt(r.registrationSource)}｜建立=${fmt(r.createdAt)}｜changeNote=${fmt(r.changeNote)}`
      );
    }
    // 依來源／changeNote 匯總，快速看出主要入口。
    const bySource = new Map<string, number>();
    for (const r of q3) {
      const kseg = `${fmt(r.registrationSource)} / ${fmt(r.changeNote)}`;
      bySource.set(kseg, (bySource.get(kseg) ?? 0) + 1);
    }
    console.log("  — 依 registrationSource / changeNote 匯總 —");
    for (const [k, n] of bySource) console.log(`    ${k}: ${n} 筆`);
  }

  console.log("\n（唯讀結束；未寫入、未修改任何資料。）");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
