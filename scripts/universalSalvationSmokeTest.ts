/**
 * V30.6 中元普渡上線前「唯讀 smoke test」。只 SELECT，不寫入。
 *
 * 執行：npx tsx scripts/universalSalvationSmokeTest.ts [民國年 預設115]
 * 輸出健康快照與各筆數差異，最後只給 PASS 或 FAIL＋明確原因。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { runUniversalSalvationPreLaunchCheck, summarizePreLaunch } from "@/lib/universalSalvationPreLaunchCheck";
import { isSmokeBlocking } from "@/lib/preLaunchRules";

// 阻擋上線的硬問題「只檢查有效、未刪除、未取消的正式項目」（見 preLaunchRules.SMOKE_BLOCKING_CATEGORIES）。
// DRAFT／空 record 屬整備期正常；CANCELLED 衍生（已取消歷史／已刪除仍有應收）一律不阻擋。

async function main() {
  const year = Number(process.argv[2] ?? 115);
  console.log(`=== V30.6 中元普渡 smoke test（唯讀）year=${year} ===\n`);

  const event = await prisma.templeEvent.findFirst({ where: { activityType: "UNIVERSAL_SALVATION", year }, select: { id: true, name: true } });
  console.log(`活動：${event?.name ?? "（找不到 TempleEvent）"} id=${event?.id ?? "—"}`);

  // 報名項目筆數（依 key × status）。
  const itemRows = await prisma.$queryRaw<{ key: string; status: string; n: number }[]>`
    SELECT rit."key", rri."status", COUNT(*)::int AS n
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId"
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL AND rri."deletedAt" IS NULL
    GROUP BY rit."key", rri."status" ORDER BY rit."key"`;
  const byKey = new Map<string, { CONFIRMED: number; DRAFT: number; CANCELLED: number }>();
  for (const r of itemRows) {
    const s = byKey.get(r.key) ?? { CONFIRMED: 0, DRAFT: 0, CANCELLED: 0 };
    if (r.status in s) (s as Record<string, number>)[r.status] += r.n;
    byKey.set(r.key, s);
  }
  console.log("\n各報名項目（CONFIRMED / DRAFT / CANCELLED）：");
  for (const [k, s] of byKey) console.log(`  ${k}: ${s.CONFIRMED} / ${s.DRAFT} / ${s.CANCELLED}`);

  // 列印物件數。
  const printObjs = await prisma.$queryRaw<{ itemType: string; n: number }[]>`
    SELECT api."itemType", COUNT(*)::int AS n FROM "additional_print_items" api
    JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL AND api."deletedAt" IS NULL
    GROUP BY api."itemType"`;
  console.log("\n列印物件：");
  for (const p of printObjs) console.log(`  ${p.itemType}: ${p.n}`);

  // 寶袋鏈：POCKET 有無 registrationItemId。
  const pocketChain = await prisma.$queryRaw<{ linked: number; unlinked: number }[]>`
    SELECT
      COUNT(*) FILTER (WHERE api."registrationItemId" IS NOT NULL)::int AS linked,
      COUNT(*) FILTER (WHERE api."registrationItemId" IS NULL)::int AS unlinked
    FROM "additional_print_items" api JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL AND api."deletedAt" IS NULL AND api."itemType" = 'POCKET'`;
  console.log(`\n寶袋鏈：已連結 registrationItemId ${pocketChain[0]?.linked ?? 0}／未連結 ${pocketChain[0]?.unlinked ?? 0}`);

  // registrationOrder 狀態。
  const orderState = await prisma.$queryRaw<{ withOrder: number; nullOrder: number }[]>`
    SELECT COUNT(*) FILTER (WHERE rri."registrationOrder" IS NOT NULL)::int AS "withOrder",
           COUNT(*) FILTER (WHERE rri."registrationOrder" IS NULL)::int AS "nullOrder"
    FROM "ritual_registration_items" rri JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION' AND rr."year" = ${year} AND rr."deletedAt" IS NULL AND rri."deletedAt" IS NULL`;
  console.log(`registrationOrder：已取號 ${orderState[0]?.withOrder ?? 0}／NULL ${orderState[0]?.nullOrder ?? 0}`);

  // 上線前檢查彙總（缺地址/缺陽上/孤兒/可列印…）。
  const findings = await runUniversalSalvationPreLaunchCheck(year);
  console.log("\n上線前檢查彙總：");
  for (const s of summarizePreLaunch(findings)) console.log(`  ${s.category}: ${s.count}`);

  // 可列印 vs 不可列印（CONFIRMED 牌位 item，扣掉有缺漏 entry 的）。
  const printable = [...byKey.entries()].filter(([k]) => ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN"].includes(k)).reduce((s, [, v]) => s + v.CONFIRMED, 0);
  const blockers = findings.filter((f) => ["缺列印地址", "缺陽上人", "缺牌位名稱"].includes(f.category)).length;
  console.log(`\n牌位可列印（CONFIRMED）約 ${printable} 筆；有列印缺漏（地址/陽上/名稱）${blockers} 筆`);

  // 下拉應有項目（活動啟用）。
  const enabled = await prisma.registrationItemType.findMany({ where: { isActive: true, activityGroup: "UNIVERSAL_SALVATION" }, orderBy: { sortOrder: "asc" }, select: { key: true, name: true } });
  console.log(`\n下拉應有項目：全部項目 + ${enabled.map((e) => e.name).join("／")}`);

  // 判定。
  const blockingFindings = findings.filter((f) => isSmokeBlocking(f.category));
  console.log("\n────────────");
  if (blockingFindings.length === 0) {
    console.log("PASS：無阻擋上線的硬問題（DRAFT／空 record 等屬正常整備，請用修復腳本 dry-run 檢視）。");
  } else {
    console.log(`FAIL：發現 ${blockingFindings.length} 筆阻擋上線問題：`);
    for (const s of summarizePreLaunch(blockingFindings)) console.log(`  - ${s.category}: ${s.count}`);
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
