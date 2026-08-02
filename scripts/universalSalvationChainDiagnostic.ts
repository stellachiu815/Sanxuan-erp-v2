/**
 * V30.4 中元普渡報名資料鏈「唯讀」診斷。
 *
 * ⚠️ 完全唯讀：只 SELECT、只印出結果，不寫入、不更新、不刪除、不 backfill。
 *
 * 用途：驗收發現「列印管理／總名單／統計只出現超拔祖先，其他項目全 0」。
 * 讀查詢層（listPrintCenterItems／buildItemRoster／listActivityItemPrintSummary）
 * 一律以 status=CONFIRMED（項目＋主報名）為條件——這是既有正式規則，未被本次修改
 * （已用 git diff 對照確認 where 條件未變）。因此若某項目沒出現，代表它的
 * RitualRegistrationItem 不是 CONFIRMED，或主報名 RitualRecord 不是 CONFIRMED，
 * 或根本沒有 item（只有牌位 entry）。本診斷把真相逐層列出，避免用猜的。
 *
 * 執行（Mac、專案根目錄；讀 .env 的 DATABASE_URL）：
 *   npx tsx scripts/universalSalvationChainDiagnostic.ts [民國年，預設 115]
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

type Row = {
  key: string;
  itemStatus: string;
  recordStatus: string;
  itemDeleted: boolean;
  hasEntry: boolean;
  n: number;
};

async function main() {
  const year = Number(process.argv[2] ?? 115);
  console.log(`=== V30.4 中元普渡資料鏈診斷（唯讀）year=${year} ===\n`);

  // 1) 主報名（RitualRecord）層：本年度中元普渡有幾筆、各狀態幾筆。
  const records = await prisma.ritualRecord.groupBy({
    by: ["status"],
    where: { activityType: "UNIVERSAL_SALVATION", year, deletedAt: null },
    _count: { _all: true },
  });
  console.log("【RitualRecord（本年度中元普渡）依 status】");
  for (const r of records) console.log(`  ${r.status}: ${r._count._all}`);

  // 2) 報名項目（RitualRegistrationItem）層：依 項目key × 項目status × 主報名status × 是否有牌位entry × 是否軟刪。
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT rit."key" AS key,
           rri."status" AS "itemStatus",
           rr."status" AS "recordStatus",
           (rri."deletedAt" IS NOT NULL) AS "itemDeleted",
           (rri."universalSalvationEntryId" IS NOT NULL) AS "hasEntry",
           COUNT(*)::int AS n
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year}
    GROUP BY rit."key", rri."status", rr."status", "itemDeleted", "hasEntry"
    ORDER BY rit."key", rri."status", rr."status"
  `;

  console.log("\n【RitualRegistrationItem 依 項目key × 項目status × 主報名status × 有無牌位entry × 軟刪】");
  console.log("  (列印管理/總名單/統計只計：itemStatus=CONFIRMED 且 recordStatus=CONFIRMED 且未軟刪)");
  const byKey = new Map<string, Row[]>();
  for (const r of rows) {
    const arr = byKey.get(r.key) ?? [];
    arr.push(r);
    byKey.set(r.key, arr);
  }
  for (const [key, arr] of byKey) {
    const total = arr.reduce((s, r) => s + r.n, 0);
    const printable = arr
      .filter((r) => r.itemStatus === "CONFIRMED" && r.recordStatus === "CONFIRMED" && !r.itemDeleted)
      .reduce((s, r) => s + r.n, 0);
    console.log(`\n  ▍${key}  總計 ${total} 筆；其中會出現在列印/總名單/統計的（CONFIRMED×CONFIRMED×未刪）＝ ${printable} 筆`);
    for (const r of arr) {
      console.log(
        `     - item=${r.itemStatus} / record=${r.recordStatus} / ${r.itemDeleted ? "已軟刪" : "未刪"} / ${r.hasEntry ? "有牌位entry" : "無牌位entry"} : ${r.n}`
      );
    }
  }

  // 3) 牌位 entry（UniversalSalvationEntry）層：有多少 entry 沒有對應的 RitualRegistrationItem（孤兒牌位）。
  const orphanEntries = await prisma.$queryRaw<{ category: string; n: number }[]>`
    SELECT e."category" AS category, COUNT(*)::int AS n
    FROM "universal_salvation_entries" e
    JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
    JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year}
      AND e."deletedAt" IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM "ritual_registration_items" x
        WHERE x."universalSalvationEntryId" = e."id" AND x."deletedAt" IS NULL
      )
    GROUP BY e."category"
    ORDER BY e."category"
  `;
  console.log("\n【孤兒牌位 entry（有 UniversalSalvationEntry 但無對應未刪 RitualRegistrationItem）依 category】");
  if (orphanEntries.length === 0) console.log("  （無）");
  for (const o of orphanEntries) console.log(`  ${o.category}: ${o.n}`);

  console.log("\n判讀提示：");
  console.log("  - 若某 key 的『CONFIRMED×CONFIRMED×未刪』為 0，但總計>0 → 它們是 DRAFT/CANCELLED 或主報名未確認 → 讀查詢正確地不顯示（非查詢 bug）。");
  console.log("  - 若孤兒牌位很多 → 牌位 entry 存在但沒有 item（項目層缺）→ 需要走 reconcileTabletItemsForRecord 補 item（寫入動作，需另行確認）。");
  console.log("\n（唯讀結束；未寫入、未修改任何資料。）");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
