/**
 * V30.3 普渡報名順序（registrationOrder）— 既有資料補號「唯讀 dry-run」盤點。
 *
 * ⚠️ 這支**完全唯讀**：只查詢、只在終端機印出結果，**不寫入、不更新、不刪除任何正式資料**。
 * 目的：在真正加欄位／migration／補號之前，先讓你看清楚「每個活動、每個報名項目」
 *       目前有幾筆、預計補號到幾號、有沒有無法分類或時間相同需靠 id 決定順序的情況。
 *
 * 使用方式（在你的 Mac、專案根目錄執行；會自動讀取 .env 的 DATABASE_URL）：
 *   npx tsx scripts/universalSalvationOrderDryRun.ts
 *
 * 補號規則（僅為預覽，未寫入）：
 *   範圍 = (RitualRecord.templeEventId, RitualRegistrationItem.registrationItemTypeId)
 *   排序 = createdAt ASC；createdAt 相同時 id ASC
 *   每個範圍各自從 1 開始，1..N（含已取消，取消資料保留原位置、名單預設不顯示）。
 */
import "dotenv/config";
import { prisma } from "@/lib/prisma";

type Row = {
  id: string;
  createdAt: Date;
  deletedAt: Date | null;
  registrationItemTypeId: string;
  registrationItemType: { key: string; name: string } | null;
  ritualRecord: {
    templeEventId: string | null;
    year: number;
    deletedAt: Date | null;
    templeEvent: { name: string } | null;
  };
};

async function main() {
  console.log("=== V30.3 普渡報名順序 dry-run（唯讀，不寫入任何資料）===\n");

  const items = (await prisma.ritualRegistrationItem.findMany({
    where: { ritualRecord: { activityType: "UNIVERSAL_SALVATION" } },
    select: {
      id: true,
      createdAt: true,
      deletedAt: true,
      registrationItemTypeId: true,
      registrationItemType: { select: { key: true, name: true } },
      ritualRecord: {
        select: {
          templeEventId: true,
          year: true,
          deletedAt: true,
          templeEvent: { select: { name: true } },
        },
      },
    },
  })) as Row[];

  console.log(`普渡（UNIVERSAL_SALVATION）RitualRegistrationItem 總筆數：${items.length}\n`);

  // 分組 key = templeEventId :: registrationItemTypeId
  const groups = new Map<string, Row[]>();
  const anomalies: string[] = [];

  for (const it of items) {
    const eid = it.ritualRecord.templeEventId ?? "(templeEventId=NULL)";
    if (!it.ritualRecord.templeEventId) {
      anomalies.push(`item ${it.id}：ritualRecord.templeEventId 為 NULL（無法歸入活動範圍）`);
    }
    const key = `${eid}::${it.registrationItemTypeId}`;
    const list = groups.get(key) ?? [];
    list.push(it);
    groups.set(key, list);
  }

  // 排序輸出：先依活動年度、活動，再依項目 sortOrder 概念（這裡用項目名稱穩定排序）
  const sortedKeys = [...groups.keys()].sort();

  let totalPlanned = 0;
  for (const key of sortedKeys) {
    const rows = groups.get(key)!;
    // 補號排序：createdAt ASC，相同再 id ASC
    rows.sort((a, b) => {
      const t = a.createdAt.getTime() - b.createdAt.getTime();
      return t !== 0 ? t : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const sample = rows[0];
    const eventName = sample.ritualRecord.templeEvent?.name ?? "(未命名活動)";
    const eventId = sample.ritualRecord.templeEventId ?? "NULL";
    const year = sample.ritualRecord.year;
    const itemKey = sample.registrationItemType?.key ?? "(未知項目)";
    const itemName = sample.registrationItemType?.name ?? sample.registrationItemTypeId;

    const total = rows.length;
    const active = rows.filter((r) => !r.deletedAt).length;
    const cancelled = rows.filter((r) => r.deletedAt).length;
    const underDeletedRitual = rows.filter((r) => r.ritualRecord.deletedAt).length;

    // 相同 createdAt（毫秒）叢集：需靠 id 決定順序（提醒，不是錯誤）
    const tsCount = new Map<number, number>();
    for (const r of rows) tsCount.set(r.createdAt.getTime(), (tsCount.get(r.createdAt.getTime()) ?? 0) + 1);
    const sameTime = [...tsCount.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);

    totalPlanned += total;

    console.log(
      `【${year}年 ${eventName}】 項目：${itemName}（${itemKey}）\n` +
        `   活動 templeEventId：${eventId}\n` +
        `   總筆數：${total}　啟用：${active}　取消：${cancelled}　預計補號：${total}（1..${total}，含取消保留原位）` +
        (underDeletedRitual ? `\n   ⚠️ 其中 ${underDeletedRitual} 筆所屬 RitualRecord 已軟刪除` : "") +
        (sameTime ? `\n   ℹ️ 有 ${sameTime} 筆 createdAt 完全相同，將以 id 穩定決定順序` : "") +
        "\n"
    );
  }

  console.log("──────────────────────────────────────────");
  console.log(`活動×項目 範圍數：${sortedKeys.length}`);
  console.log(`預計補號總筆數：${totalPlanned}`);
  if (anomalies.length) {
    console.log(`\n⚠️ 需人工確認的資料（${anomalies.length} 筆）：`);
    for (const a of anomalies.slice(0, 50)) console.log(`   - ${a}`);
    if (anomalies.length > 50) console.log(`   …其餘 ${anomalies.length - 50} 筆略`);
  } else {
    console.log("無無法分類或重複來源的資料。");
  }
  console.log("\n（本次為唯讀 dry-run，未寫入任何資料。請確認上述筆數後再進行實際補號。）");
}

main()
  .catch((e) => {
    console.error("dry-run 失敗：", e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
