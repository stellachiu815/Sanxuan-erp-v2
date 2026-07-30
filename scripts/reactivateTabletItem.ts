/**
 * 使用者「重新報名」先前被取消的牌位——限指定 entryId、可預覽（dry-run 預設）。
 *
 * 在同一 transaction 內恢復 Entry 與其 item：
 *   Entry.deletedAt=null、item.status=DRAFT、item.deletedAt=null、item.deletedByName=null。
 * 不改金額／付款／收據／列印／itemType／ritualRecord／Entry 內容。
 *
 *   # 預覽（唯讀）——可一次多筆，逗號分隔
 *   ENTRY=cms5yrp6q0007ed2a2zcqmwzt npx tsx scripts/reactivateTabletItem.ts
 *   ENTRY=id1,id2,id3 npx tsx scripts/reactivateTabletItem.ts
 *   # 實際套用
 *   ENTRY=id1,id2,id3 npx tsx scripts/reactivateTabletItem.ts --commit
 */
import { prisma } from "../src/lib/prisma";
import { reactivateTabletItemForReRegistration } from "../src/lib/tabletItemBackfill";

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  const raw = process.env.ENTRY || "";
  const entryIds = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (entryIds.length === 0) {
    console.error("請以 ENTRY=<entryId[,entryId...]> 指定要重新報名的牌位 Entry。");
    process.exit(1);
  }

  console.log(`\n===== 重新報名（恢復取消牌位）（${commit ? "COMMIT" : "DRY-RUN 唯讀"}）=====`);
  console.log(`entryIds：${entryIds.join(", ")}\n`);

  let restored = 0, alreadyActive = 0, failed = 0;
  for (const entryId of entryIds) {
    const res = await reactivateTabletItemForReRegistration(entryId, { commit });
    if (!res.ok) {
      failed++;
      console.log(`⛔ ${entryId}：${res.reason}`);
    } else if (res.action === "ALREADY_ACTIVE") {
      alreadyActive++;
      console.log(`✅ ${res.displayName}（${entryId}）已是有效項目，無需恢復。`);
    } else {
      restored++;
      console.log(
        `♻️ ${res.displayName}（${entryId}）　item ${res.itemId}：status=${res.fromStatus}→DRAFT、item.deletedAt→null` +
          `${res.entryWasDeleted ? "、Entry.deletedAt→null" : ""}` +
          `${commit ? "　✅ 已套用" : "　[DRY-RUN 未寫入]"}`
      );
    }
  }
  console.log(`\n小計：將恢復/已恢復=${restored}　已是有效=${alreadyActive}　拒絕=${failed}`);
  if (!commit) console.log(`[DRY-RUN] 未寫入任何資料。加 --commit 才套用。`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
