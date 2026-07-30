/**
 * 一次性修復「Entry 有效、但 item 已取消」的卡死牌位（方案 A）——**嚴格限縮範圍**。
 *
 * 本次只允許修復：
 *   - category ∈ { ANCESTOR_LINE, INDIVIDUAL_SOUL }（歷代祖先／乙位正魂）
 *   - Entry.deletedAt IS NULL（名冊仍有效）
 *   - 對應 RitualRegistrationItem.status = CANCELLED（已取消才恢復）
 * **絕不**碰 DEBT_CREDITOR（冤親債主）／UNBORN_CHILD（無緣子女）／其他 category，
 * 也不建立任何新 item（只恢復既有被取消的），不處理其他年度以外的資料（以 YEAR 限定）。
 *
 * 恢復走正式建立函式 ensureLinkedTabletItem：狀態回 DRAFT、清 deletedAt/deletedByName、
 * **重算 amountUnpaid = amountDue − amountPaid**，保留既有付款與列印紀錄。
 *
 * **非 GET／不由開頁觸發**，僅此手動 CLI；預設 dry-run（唯讀），加 --commit 才寫入。
 *
 *   # 預覽（唯讀）
 *   HH=F00001 YEAR=115 npx tsx scripts/repairStuckTabletItems.ts
 *   # 實際修復
 *   HH=F00001 YEAR=115 npx tsx scripts/repairStuckTabletItems.ts --commit
 */
import { prisma } from "../src/lib/prisma";
import { ensureLinkedTabletItem } from "../src/lib/registrationItemRegistration";

const HH = process.env.HH || "F00001";
const YEAR = process.env.YEAR ? Number(process.env.YEAR) : null;
const REPAIR_CATEGORIES = ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"] as const;

type Target = {
  entryId: string;
  name: string;
  category: string;
  itemId: string;
  amountDue: number;
  amountPaid: number;
  amountUnpaidNow: number;
  amountUnpaidAfter: number;
};

async function findTargets(recordId: string): Promise<Target[]> {
  const usd = await prisma.universalSalvationDetail.findUnique({ where: { ritualRecordId: recordId }, select: { id: true } });
  if (!usd) return [];
  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      universalSalvationId: usd.id,
      deletedAt: null, // Entry 必須有效
      category: { in: REPAIR_CATEGORIES as unknown as string[] as never },
      registrationItem: { is: { status: "CANCELLED" } }, // 只恢復「已取消」的 item
    },
    select: {
      id: true, displayName: true, category: true,
      registrationItem: { select: { id: true, amountDue: true, amountPaid: true, amountUnpaid: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return entries.flatMap((e): Target[] => {
    const it = e.registrationItem;
    if (!it) return [];
    const due = Number(it.amountDue);
    const paid = Number(it.amountPaid);
    return [{
      entryId: e.id, name: e.displayName, category: e.category, itemId: it.id,
      amountDue: due, amountPaid: paid, amountUnpaidNow: Number(it.amountUnpaid),
      amountUnpaidAfter: Math.max(0, Math.round((due - paid) * 100) / 100),
    }];
  });
}

async function main() {
  const commit = process.argv.slice(2).includes("--commit");
  console.log(`\n===== 一次性修復卡死牌位（限祖先/乙位正魂・已取消）（${commit ? "COMMIT 實際寫入" : "DRY-RUN 唯讀預覽"}）=====`);
  console.log(`家戶：${HH}　年度：${YEAR ?? "全部普渡年度"}　允許分類：${REPAIR_CATEGORIES.join(", ")}\n`);

  const records = await prisma.ritualRecord.findMany({
    where: { householdId: HH, activityType: "UNIVERSAL_SALVATION", deletedAt: null, ...(YEAR ? { year: YEAR } : {}) },
    orderBy: { year: "desc" },
    select: { id: true, year: true, status: true },
  });
  if (records.length === 0) return console.log("找不到普渡報名主檔。");

  let willRestore = 0;
  let healed = 0;
  for (const rec of records) {
    const targets = await findTargets(rec.id);
    willRestore += targets.length;
    console.log(`■ 年度 ${rec.year}（status=${rec.status}, recordId=${rec.id}）— 符合修復條件 ${targets.length} 筆`);
    for (const t of targets) {
      console.log(`   ♻️ 將恢復 ${t.category}｜${t.name}　item=${t.itemId} status=CANCELLED→DRAFT；amountUnpaid ${t.amountUnpaidNow} → ${t.amountUnpaidAfter}（=amountDue ${t.amountDue} − amountPaid ${t.amountPaid}）　entryId=${t.entryId}`);
    }
    if (commit) {
      for (const t of targets) {
        await prisma.$transaction((tx) =>
          ensureLinkedTabletItem(tx, { ritualRecordId: rec.id, entryId: t.entryId, category: t.category, year: rec.year, status: "DRAFT", memberId: null })
        );
        healed += 1;
      }
      if (targets.length > 0) {
        console.log(`   ✅ 已恢復 ${targets.length} 筆`);
        for (const t of targets) {
          const it = await prisma.ritualRegistrationItem.findUnique({ where: { id: t.itemId }, select: { status: true, deletedAt: true, amountDue: true, amountUnpaid: true } });
          console.log(`      現況：${t.name}　status=${it?.status} deletedAt=${it?.deletedAt ? "有" : "null"} amountDue=${Number(it?.amountDue)} amountUnpaid=${Number(it?.amountUnpaid)}`);
        }
      }
    }
  }

  console.log(`\n小計：將恢復=${willRestore}　將建立=0　拒絕=0${commit ? `　已恢復 ${healed} 筆` : "　（DRY-RUN 未寫入，確認後加 --commit 才套用）"}`);
  console.log("");
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
