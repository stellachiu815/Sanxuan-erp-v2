/**
 * 普渡牌位「孤立 Entry」修復 CLI（安全、可重跑）。
 *
 * 預設 dry-run（唯讀）：列出 deletedAt=null、卻沒有對應 RitualRegistrationItem 的有效
 * 祖先／乙位正魂 Entry，並回報 item type seed 狀態，不做任何寫入。
 *
 *   # 1) 先預覽（唯讀）——建議先跑這個，確認清單
 *   npx tsx scripts/backfillMissingTabletItems.ts
 *   # 只看某一戶
 *   HH=F00001 npx tsx scripts/backfillMissingTabletItems.ts
 *
 *   # 2) 實際補（會先以官方 seed 路徑補齊 item type，再補缺少的 item；冪等可重跑）
 *   npx tsx scripts/backfillMissingTabletItems.ts --commit
 *   HH=F00001 npx tsx scripts/backfillMissingTabletItems.ts --commit
 *
 *   # 進階：納入冤親債主／無緣子女（預設不含，須人工先確認是否重複）
 *   npx tsx scripts/backfillMissingTabletItems.ts --include-debt --include-unborn
 *   # 排除特定（例如判定為重複的早期冤親）Entry：
 *   npx tsx scripts/backfillMissingTabletItems.ts --include-debt --exclude=ENTRYID1,ENTRYID2 --commit
 *
 * 不刪除、不改 Entry 內容、不動付款／收據／列印／確認狀態。
 */
import { prisma } from "../src/lib/prisma";
import {
  backfillMissingTabletItems,
  DEFAULT_BACKFILL_CATEGORIES,
  type TabletBackfillCategory,
} from "../src/lib/tabletItemBackfill";

async function main() {
  const args = process.argv.slice(2);
  const commit = args.includes("--commit");
  const householdId = process.env.HH || null;
  const categories: TabletBackfillCategory[] = [...DEFAULT_BACKFILL_CATEGORIES];
  if (args.includes("--include-debt")) categories.push("DEBT_CREDITOR");
  if (args.includes("--include-unborn")) categories.push("UNBORN_CHILD");
  const excludeArg = args.find((a) => a.startsWith("--exclude="));
  const excludeEntryIds = excludeArg ? excludeArg.slice("--exclude=".length).split(",").map((s) => s.trim()).filter(Boolean) : [];

  console.log(`\n===== 牌位孤立 Entry 修復（${commit ? "COMMIT 實際寫入" : "DRY-RUN 唯讀預覽"}）=====`);
  console.log(`家戶：${householdId ?? "全部"}　分類：${categories.join(", ")}　排除：${excludeEntryIds.length ? excludeEntryIds.join(", ") : "（無）"}\n`);

  const res = await backfillMissingTabletItems({ householdId, categories, excludeEntryIds, commit });

  console.log(`掃描到孤立 Entry（無有效 item）：${res.scanned} 筆`);
  const byCat: Record<string, number> = {};
  for (const o of res.orphans) byCat[o.category] = (byCat[o.category] ?? 0) + 1;
  console.log(`   依分類：${JSON.stringify(byCat)}`);

  const actionTag: Record<string, string> = {
    CREATE: "→ 待新建 item",
    RESTORE: "♻️ 將恢復既有 item",
    SKIP_EXCLUDED: "（排除）",
    FAIL: "⛔ 拒絕自動處理",
  };
  for (const p of res.plan) {
    const o = p.entry;
    console.log(
      `   ${actionTag[p.action]} ${o.householdId}｜${o.year}年｜${o.category}｜${o.displayName}` +
        `　entryId=${o.entryId}${p.reason ? `　原因：${p.reason}` : ""}`
    );
  }

  const planned = (a: string) => res.plan.filter((p) => p.action === a).length;

  if (commit) {
    console.log(`\n已透過官方 seed 路徑新建 item type：${res.seededItemTypes} 個`);
    console.log(`結果：restored=${res.restored.length}　created=${res.created.length}　skipped=${res.skipped.length}　failed=${res.failed.length}`);
    if (res.restored.length) console.log(`   恢復 entryIds：${res.restored.join(", ")}`);
    if (res.created.length) console.log(`   新建 entryIds：${res.created.join(", ")}`);
    if (res.failed.length) res.failed.forEach((f) => console.log(`   ⛔ ${f.entryId}：${f.reason}`));
  } else {
    console.log(
      `\n[DRY-RUN] 未寫入任何資料。加 --commit 才執行。` +
        `　將恢復=${planned("RESTORE")}　將新建=${planned("CREATE")}　排除=${planned("SKIP_EXCLUDED")}　拒絕=${planned("FAIL")}`
    );
    if (planned("FAIL")) console.log(`   ⛔ 有拒絕項（如同一 Entry 多筆歷史 item），需人工確認，commit 也不會處理。`);
  }
  console.log("");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
