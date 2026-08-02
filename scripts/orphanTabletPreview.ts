/**
 * V30.4 孤兒冤親（有 UniversalSalvationEntry、無有效 RitualRegistrationItem）「唯讀」reconcile 預覽。
 *
 * ⚠️ 完全唯讀：只呼叫既有官方 dry-run `backfillMissingTabletItems({ commit:false })`（不 seed、不寫入、
 *   不刪除、不合併、不 backfill），再讀家戶名稱與 entry 建立時間補充顯示。**本輪不補資料**。
 *
 * 執行（Mac、專案根目錄；讀 .env 的 DATABASE_URL）：
 *   npx tsx scripts/orphanTabletPreview.ts [民國年 預設115]
 *
 * 每筆顯示：entry id、家戶、姓名、建立時間、以及是否可唯一建立／連結 US_YUANQIN item：
 *   CREATE  → 完全沒有 item 列，可唯一新建一筆 US_YUANQIN item（1:1，universalSalvationEntryId 唯一）。
 *   RESTORE → 恰有 1 筆軟刪 item，可唯一恢復（不新建、不合併）。
 *   FAIL    → 同一 entry 有多筆歷史 item 或分類無對應 → 不可自動判定，維持原狀、待人工。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { backfillMissingTabletItems } from "@/lib/tabletItemBackfill";

async function main() {
  const year = Number(process.argv[2] ?? 115);
  console.log(`=== V30.4 孤兒冤親 reconcile 預覽（唯讀，不補資料）year=${year} ===\n`);

  // 官方 dry-run（commit:false）——只規劃、不寫入。scope 到累世冤親債主（DEBT_CREDITOR）。
  const plan = await backfillMissingTabletItems({ commit: false, categories: ["DEBT_CREDITOR"] });

  // 只看指定年度的孤兒。
  const items = plan.plan.filter((p) => p.entry.year === year);
  if (items.length === 0) {
    console.log("（本年度無孤兒冤親）");
    console.log(`\n（唯讀結束；committed=${plan.committed}；未寫入、未補資料。）`);
    return;
  }

  // 補充家戶名稱與 entry 建立時間（唯讀）。
  const entryIds = items.map((p) => p.entry.entryId);
  const householdIds = [...new Set(items.map((p) => p.entry.householdId))];
  const [entries, households] = await Promise.all([
    prisma.universalSalvationEntry.findMany({ where: { id: { in: entryIds } }, select: { id: true, createdAt: true } }),
    prisma.household.findMany({ where: { id: { in: householdIds } }, select: { id: true, name: true } }),
  ]);
  const createdById = new Map(entries.map((e) => [e.id, e.createdAt]));
  const nameById = new Map(households.map((h) => [h.id, h.name]));

  const uniquely = (a: string) => (a === "CREATE" || a === "RESTORE" ? "可唯一處理" : "需人工");
  for (const p of items) {
    const e = p.entry;
    console.log(
      `  ▸ entry=${e.entryId}｜家戶=${nameById.get(e.householdId) ?? e.householdId}｜姓名=${e.displayName}｜` +
        `建立=${createdById.get(e.entryId)?.toISOString() ?? "—"}｜動作=${p.action}（${uniquely(p.action)}）` +
        (p.reason ? `｜原因=${p.reason}` : "")
    );
  }

  const by = (a: string) => items.filter((p) => p.action === a).length;
  console.log(
    `\n小計：共 ${items.length} 筆｜CREATE(可唯一新建) ${by("CREATE")}｜RESTORE(可唯一恢復) ${by("RESTORE")}｜` +
      `FAIL(需人工) ${by("FAIL")}｜SKIP_EXCLUDED ${by("SKIP_EXCLUDED")}`
  );
  console.log(`\n（唯讀結束；committed=${plan.committed}（應為 false）；未 seed、未寫入、未補資料。）`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
