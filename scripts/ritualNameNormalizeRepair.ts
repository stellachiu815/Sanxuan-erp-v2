/**
 * V33.2 既有記事資料「名稱正規化為核心值」修復（dry-run 預設；--commit 才寫入）。
 *
 *   npx tsx scripts/ritualNameNormalizeRepair.ts            # 唯讀預覽
 *   npx tsx scripts/ritualNameNormalizeRepair.ts --commit   # 交易、冪等、可重跑
 *
 * 只把「可 100% 確認」者正規化為核心值（去後綴）：
 *   王姓歷代祖先 → 王姓；王姓歷代祖先歷代祖先 → 王姓；陳永育乙位正魂 → 陳永育。
 * 疑似類型錯誤（D：王姓乙位正魂／陳永育歷代祖先／府）與無法判斷（E）一律 **NEEDS_REVIEW，不自動改**。
 * 只改 WorshipRecord／UniversalSalvationEntry 的 displayName；不動收款/財務/工作單/registrationOrder/
 * printCount/printedAt/lastPrintedAt/地址/陽上/寶袋/AdditionalPrintItem。
 */
import { prisma } from "../src/lib/prisma";
import { classifyRitualName, categoryFromWorshipType, type RitualNameCategory } from "../src/lib/ritualDisplayName";

async function main() {
  const commit = process.argv.includes("--commit");

  const worship = await prisma.$queryRawUnsafe<{ id: string; type: string; name: string | null }[]>(
    `SELECT "id","type","displayName" AS name FROM "worship_records" WHERE "deletedAt" IS NULL AND "type" IN ('ANCESTOR_LINE','INDIVIDUAL')`
  );
  const entries = await prisma.$queryRawUnsafe<{ id: string; cat: string; name: string | null }[]>(
    `SELECT "id","category" AS cat,"displayName" AS name FROM "universal_salvation_entries" WHERE "deletedAt" IS NULL AND "category" IN ('ANCESTOR_LINE','INDIVIDUAL_SOUL')`
  ).catch(() => [] as { id: string; cat: string; name: string | null }[]);

  type Fix = { table: "worship_records" | "universal_salvation_entries"; id: string; from: string; to: string };
  const fixes: Fix[] = [];
  const needsReview: { table: string; id: string; value: string; classification: string }[] = [];

  const consider = (table: Fix["table"], id: string, cat: RitualNameCategory | null, raw: string) => {
    if (!cat) return;
    const c = classifyRitualName(cat, raw);
    if (c.classification === "D_TYPE_TEXT_MISMATCH" || c.classification === "E_UNRESOLVABLE") {
      needsReview.push({ table, id, value: raw, classification: c.classification });
      return;
    }
    // A/B/C 可安全轉核心（core）。只在與現值不同時列入。
    if (c.core && c.core !== raw) fixes.push({ table, id, from: raw, to: c.core });
  };

  for (const w of worship) consider("worship_records", w.id, categoryFromWorshipType(w.type), w.name ?? "");
  for (const e of entries) consider("universal_salvation_entries", e.id, e.cat as RitualNameCategory, e.name ?? "");

  console.log("=== V33.2 記事名稱正規化為核心值 ===");
  console.log(`模式：${commit ? "COMMIT（會寫入）" : "DRY-RUN（唯讀）"}`);
  console.log(`可自動正規化：${fixes.length} 筆｜NEEDS_REVIEW（不自動改）：${needsReview.length} 筆`);
  for (const f of fixes.slice(0, 50)) console.log(`  ${f.table} ${f.id}｜「${f.from}」→「${f.to}」`);
  if (fixes.length > 50) console.log(`  …其餘 ${fixes.length - 50} 筆`);
  if (needsReview.length) console.log("  NEEDS_REVIEW 範例：", needsReview.slice(0, 10));

  if (!commit) { console.log("\nDRY-RUN 結束，未寫入。確認後加 --commit。"); return; }
  if (fixes.length === 0) { console.log("\n無可自動正規化項目。"); return; }

  const n = await prisma.$transaction(async (tx) => {
    let c = 0;
    for (const f of fixes) {
      c += Number(await tx.$executeRawUnsafe(
        `UPDATE "${f.table}" SET "displayName" = $1 WHERE "id" = $2 AND "displayName" = $3`,
        f.to, f.id, f.from
      )) || 0;
    }
    return c;
  });
  console.log(`\nCOMMIT 完成：正規化 ${n} 筆為核心值（冪等，可重跑）。NEEDS_REVIEW 未動。`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
