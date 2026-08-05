/**
 * V36.5B：既有 115 資料補建這一筆額外寶袋姓名（dry-run 預設；--commit 才寫入）。
 *   目標：江佩文家戶／江姓歷代祖先牌位／額外寶袋姓名「江士耀」。
 *   **只補這一筆，不碰陳永成或其他資料。**
 *
 * 冪等：該牌位已有 printName='江士耀' 的額外寶袋則不重複建立。
 * 建立：1 筆 US_POCKET_EXTRA（由 createAdditionalPrintItem 內部建立）＋ 1 個
 *       AdditionalPrintItem(isExtra=true, usesSourceName=false, customPrintName='江士耀')，DRAFT，不進已收/帳本。
 *
 *   npx tsx scripts/backfillJiangShiyaoPocket115.ts            # 預覽
 *   npx tsx scripts/backfillJiangShiyaoPocket115.ts --commit   # 寫入
 */
import { prisma } from "../src/lib/prisma";
import { createAdditionalPrintItem } from "../src/lib/additionalPrintItems";

const YEAR = 115;
const POCKET_NAME = "江士耀";
const HOUSEHOLD_HINT = "江佩文"; // 家戶戶名／聯絡人／成員含此字
const OPERATOR = "系統：V36.5B 額外寶袋姓名補建";
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`=== V36.5B 補建額外寶袋「${POCKET_NAME}」（${commit ? "COMMIT" : "DRY-RUN"}）===\n`);

  // 找「江姓歷代祖先」牌位，且其家戶與江佩文相關（戶名/聯絡人/成員含「江佩文」）。
  const cands = await q<{ eid: string; disp: string; hh: string; hhname: string | null; contact: string | null }>(
    `SELECT e."id" AS eid, e."displayName" AS disp, rr."householdId" AS hh, h."name" AS hhname, h."contactName" AS contact
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     LEFT JOIN "households" h ON h."id"=rr."householdId"
     WHERE e."deletedAt" IS NULL AND rr."deletedAt" IS NULL AND rr."year"=${YEAR}
       AND rr."activityType"::text='UNIVERSAL_SALVATION' AND e."category"::text='ANCESTOR_LINE'
       AND (e."displayName" LIKE '%江姓%')
       AND (h."name" LIKE '%${HOUSEHOLD_HINT}%' OR h."contactName" LIKE '%${HOUSEHOLD_HINT}%'
            OR EXISTS (SELECT 1 FROM "members" m WHERE m."householdId"=rr."householdId" AND m."name" LIKE '%${HOUSEHOLD_HINT}%'))`);

  if (cands.length === 0) { console.error(`找不到江佩文的「江姓歷代祖先」牌位，請人工確認家戶/牌位後再跑。中止。`); process.exit(1); }
  if (cands.length > 1) {
    console.log(`⚠ 找到 ${cands.length} 個候選牌位，請確認要補到哪一個（本腳本只在唯一時自動補）：`);
    for (const c of cands) console.log(`   - entry ${c.eid}｜${c.disp}｜家戶 ${c.hh}｜${c.hhname ?? "?"}｜聯絡人 ${c.contact ?? "-"}`);
    console.log(`（多筆時未自動補建，請縮小條件或改指定 entryId。）`);
    process.exit(2);
  }

  const target = cands[0];
  console.log(`目標牌位：entry ${target.eid}｜${target.disp}｜家戶 ${target.hh}｜${target.hhname ?? "?"}`);

  const exists = Number((await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "additional_print_items"
     WHERE "sourceEntryId"=$1 AND "itemType"::text='POCKET' AND "isExtra"=true AND "printName"=$2 AND "deletedAt" IS NULL`,
    target.eid, POCKET_NAME))[0]?.n ?? 0);
  if (exists > 0) { console.log(`\n已存在額外寶袋「${POCKET_NAME}」→ 冪等略過，無需補建。`); return; }

  console.log(`\n將建立：US_POCKET_EXTRA 報名項目 ×1 ＋ AdditionalPrintItem(isExtra=true, usesSourceName=false, printName='${POCKET_NAME}') ×1（DRAFT，不進已收）。`);
  if (!commit) { console.log(`（DRY-RUN，未寫入。加 --commit 執行。）`); return; }

  const res = await createAdditionalPrintItem(target.hh, YEAR, target.eid,
    { itemType: "POCKET", usesSourceName: false, customPrintName: POCKET_NAME, quantity: 1, isExtra: true, isChargeable: true },
    OPERATOR, prisma);
  console.log(res.ok ? `✓ 已補建額外寶袋「${POCKET_NAME}」` : `✗ 失敗：${res.error}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
