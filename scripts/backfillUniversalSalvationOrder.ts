/**
 * V30.3 普渡報名順序 registrationOrder 既有資料補號。
 *
 * 只補指定活動（115年中元普渡）：templeEventId = cmrpclk3m0000ga1tddnw7bm4
 * 各 registrationItemTypeId 分開，依 createdAt ASC、相同再 id ASC，補成 1..N。
 * 取消（deletedAt 非空）資料也取得並保留號碼（正式名單可跳號，正確）。
 * 同時把該筆 RitualRegistrationItem.templeEventId 回填為此活動 id（供唯一約束與查詢）。
 *
 * ⚠️ templeEventId = NULL 的無活動歸屬舊資料**一律不碰**（不補號、不回填、不占用順序）。
 * ⚠️ 不改 RitualRecord / Member / Household / 牌位內容 / 金額 / 收款。
 *
 * 執行（你的 Mac、專案根目錄；自動讀 .env 的 DATABASE_URL）：
 *   npx tsx scripts/backfillUniversalSalvationOrder.ts              # 預設 dry-run，只印計畫、不寫入
 *   npx tsx scripts/backfillUniversalSalvationOrder.ts --commit     # 確認後才真正寫入
 *   npx tsx scripts/backfillUniversalSalvationOrder.ts --event <id> # 指定其他活動（預設為 115 年普渡）
 */
import "dotenv/config";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { computeBackfillOrders } from "@/lib/registrationOrder";

const DEFAULT_EVENT_ID = "cmrpclk3m0000ga1tddnw7bm4"; // 115年中元普渡

function parseArgs() {
  const argv = process.argv.slice(2);
  let commit = false;
  let eventId = DEFAULT_EVENT_ID;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--commit") commit = true;
    else if (argv[i] === "--event") eventId = argv[++i] ?? eventId;
  }
  return { commit, eventId };
}

async function main() {
  const { commit, eventId } = parseArgs();
  console.log(`=== V30.3 普渡 registrationOrder 補號 ${commit ? "【正式寫入 --commit】" : "【dry-run，不寫入】"} ===`);
  console.log(`目標活動 templeEventId：${eventId}\n`);

  // 只取「該活動」的報名（透過 RitualRecord.templeEventId join；含取消，保留原位）。
  const items = await prisma.ritualRegistrationItem.findMany({
    where: { ritualRecord: { templeEventId: eventId } },
    select: {
      id: true,
      createdAt: true,
      deletedAt: true,
      registrationItemTypeId: true,
      registrationItemType: { select: { key: true, name: true } },
    },
  });

  if (items.length === 0) {
    console.log("此活動沒有任何普渡報名資料，無需補號。");
    return;
  }

  // 分組：registrationItemTypeId
  const groups = new Map<string, typeof items>();
  for (const it of items) {
    const list = groups.get(it.registrationItemTypeId) ?? [];
    list.push(it);
    groups.set(it.registrationItemTypeId, list);
  }

  const updates: { id: string; registrationOrder: number }[] = [];
  for (const [, rows] of groups) {
    const sample = rows[0];
    const itemName = sample.registrationItemType?.name ?? sample.registrationItemTypeId;
    const itemKey = sample.registrationItemType?.key ?? "";
    const orders = computeBackfillOrders(rows);
    const active = rows.filter((r) => !r.deletedAt).length;
    const cancelled = rows.filter((r) => r.deletedAt).length;
    console.log(
      `項目：${itemName}（${itemKey}）　總 ${rows.length}　啟用 ${active}　取消 ${cancelled}　→ 補號 1..${rows.length}`
    );
    updates.push(...orders);
  }

  console.log(`\n合計：${groups.size} 個項目、${updates.length} 筆將補號。`);

  if (!commit) {
    console.log("\n（dry-run：未寫入任何資料。確認上述筆數後，加 --commit 才會真正寫入。）");
    return;
  }

  // 正式寫入：逐筆 raw UPDATE，同時回填 templeEventId 與 registrationOrder。
  // 用交易確保整批一致；raw SQL 不依賴 Prisma client 是否已 regenerate。
  await prisma.$transaction(async (tx) => {
    for (const u of updates) {
      await tx.$executeRaw`
        UPDATE "ritual_registration_items"
        SET "templeEventId" = ${eventId}, "registrationOrder" = ${u.registrationOrder}
        WHERE "id" = ${u.id}
      `;
    }
  }, { timeout: 120_000 });

  console.log(`\n✅ 已寫入 ${updates.length} 筆 registrationOrder 與 templeEventId（僅此活動；NULL 舊資料未動）。`);
}

main()
  .catch((e) => {
    if (e instanceof Prisma.PrismaClientKnownRequestError) console.error("補號失敗（Prisma）：", e.code, e.message);
    else console.error("補號失敗：", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
