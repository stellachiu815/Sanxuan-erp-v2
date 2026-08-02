/**
 * V30.6 「中元普渡上線前檢查」CLI（唯讀）——復用共用資料層 runUniversalSalvationPreLaunchCheck，
 * 與唯讀 API／系統管理頁同一份判斷，不建第二套。只 SELECT，不寫入、不修復。
 *
 * 執行：npx tsx scripts/universalSalvationPreLaunchCheck.ts [民國年 預設115]
 */
import "dotenv/config";
import { runUniversalSalvationPreLaunchCheck, summarizePreLaunch } from "@/lib/universalSalvationPreLaunchCheck";

async function main() {
  const year = Number(process.argv[2] ?? 115);
  console.log(`=== V30.6 中元普渡上線前檢查（唯讀）year=${year} ===\n`);
  const findings = await runUniversalSalvationPreLaunchCheck(year);

  console.log(`共 ${findings.length} 筆待處理，分類：`);
  for (const s of summarizePreLaunch(findings)) console.log(`  ${s.category}: ${s.count}`);

  const byCat = new Map<string, typeof findings>();
  for (const f of findings) { const a = byCat.get(f.category) ?? []; a.push(f); byCat.set(f.category, a); }
  console.log("\n── 明細 ──");
  for (const [cat, arr] of byCat) {
    console.log(`\n【${cat}】`);
    for (const f of arr) console.log(`  家戶=${f.household}｜對象=${f.subject}｜record=${f.recordId ?? "—"}｜entry=${f.entryId ?? "—"}｜item=${f.itemId ?? "—"}｜原因=${f.reason}｜建議=${f.action}`);
  }
  console.log("\n（唯讀結束；預設不自動修復。實際修復請用 scripts/universalSalvationRepair.ts 且需 --commit。）");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
