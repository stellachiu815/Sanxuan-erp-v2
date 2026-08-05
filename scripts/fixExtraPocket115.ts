/**
 * V36.5A：既有 115 資料「額外寶袋補建」（dry-run 預設；--commit 才寫入）。**只處理額外寶袋，不碰陳永成。**
 *
 * 背景：V36.5 已修正匯入確認流程（CREATE／UPDATE／SKIP 三路徑共用冪等 helper 建額外寶袋），
 *   但那只對未來/重新匯入生效；115 已 CONFIRMED 的列不會自動回補，故用本腳本補既有資料。
 *
 * 規則：對 115 匯入列中 extraPocketCount>0、但目標牌位尚無 isExtra=true 額外寶袋者，
 *   以正式核心 createAdditionalPrintItem（isExtra=true、isChargeable=true，DRAFT，不進已收/帳本、
 *   不動任何既有財務）補建。已有額外寶袋者略過（冪等，不重複）。
 *
 *   npx tsx scripts/fixExtraPocket115.ts            # 預覽（不寫入）
 *   npx tsx scripts/fixExtraPocket115.ts --commit   # 正式補建
 */
import { prisma } from "../src/lib/prisma";
import { createAdditionalPrintItem } from "../src/lib/additionalPrintItems";
import { normalizeRitualNameForStore } from "../src/lib/ritualDisplayName";

const YEAR = 115;
const OPERATOR = "系統：V36.5A 額外寶袋補建";
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`=== V36.5A 115 額外寶袋補建（${commit ? "COMMIT" : "DRY-RUN"}）===\n`);

  const rows = await q<{ rowNumber: number; normalizedData: unknown; editedData: unknown; existingRecordId: string | null; confirmedRecordId: string | null }>(
    `SELECT r."rowNumber", r."normalizedData", r."editedData", r."existingRecordId", r."confirmedRecordId"
     FROM "purification_import_rows" r JOIN "purification_import_batches" b ON b."id"=r."batchId"
     WHERE b."year"=${YEAR} AND r."confirmationStatus"='CONFIRMED'`);

  let planned = 0, done = 0, skipped = 0;
  for (const r of rows) {
    const nd = ((r.editedData ?? r.normalizedData) ?? {}) as Record<string, unknown>;
    const extra = Math.max(0, Math.floor(Number(nd.extraPocketCount ?? 0)) || 0);
    if (extra <= 0) continue;
    const cat = String(nd.tabletCategory ?? "");
    const core = normalizeRitualNameForStore(cat, String(nd.tabletName ?? nd.devoteeName ?? ""));

    // 目標牌位 entry：SKIP/UPDATE→existingRecordId（即既有牌位 entry id）；CREATE→confirmedRecordId 底下同類最新。
    let entryId = r.existingRecordId;
    let householdId: string | null = null;
    if (entryId) {
      householdId = (await q<{ hh: string }>(
        `SELECT rr."householdId" AS hh FROM "universal_salvation_entries" e
         JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
         JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId" WHERE e."id"=$1`, entryId))[0]?.hh ?? null;
    } else if (r.confirmedRecordId) {
      const e = (await q<{ id: string; hh: string }>(
        `SELECT e."id" AS id, rr."householdId" AS hh FROM "universal_salvation_entries" e
         JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
         JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
         WHERE d."ritualRecordId"=$1 AND e."deletedAt" IS NULL AND e."category"::text=$2
         ORDER BY e."createdAt" DESC`, r.confirmedRecordId, cat))[0];
      entryId = e?.id ?? null; householdId = e?.hh ?? null;
    }
    if (!entryId || !householdId) { console.log(`  行#${r.rowNumber}：找不到目標牌位（core=${core}），略過`); continue; }

    const has = Number((await q<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM "additional_print_items" WHERE "sourceEntryId"=$1 AND "itemType"::text='POCKET' AND "isExtra"=true AND "deletedAt" IS NULL`, entryId))[0]?.n ?? 0);
    if (has > 0) { skipped++; console.log(`  行#${r.rowNumber}：牌位 ${entryId} 已有額外寶袋，略過（冪等）`); continue; }

    planned++;
    console.log(`  行#${r.rowNumber}：牌位 ${entryId}（core=${core}）→ 將補建額外寶袋 x${extra}`);
    if (commit) {
      const res = await createAdditionalPrintItem(householdId, YEAR, entryId,
        { itemType: "POCKET", usesSourceName: true, quantity: extra, isExtra: true, isChargeable: true }, OPERATOR, prisma);
      if (!res.ok) console.error(`    ✗ 失敗：${res.error}`); else { done++; console.log(`    ✓ 已補建`); }
    }
  }

  console.log(`\n計畫補建 ${planned} 筆｜已略過(已存在) ${skipped} 筆${commit ? `｜實際完成 ${done} 筆` : "（DRY-RUN 未寫入）"}`);
  console.log(`（未觸碰基本寶袋建立流程、未修改任何既有收款/財務/列印紀錄。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
