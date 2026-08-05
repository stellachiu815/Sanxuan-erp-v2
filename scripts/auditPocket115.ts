/**
 * V36.4A：115 普渡「寶袋（POCKET）逐筆對帳」（唯讀，只 SELECT，不刪除/不修改）。
 *
 * 沿用列印中心同一份資料（additional_print_items, itemType=POCKET, 未刪除, 本年度普渡），
 * 逐筆列出並自動分類：基本寶袋(isExtra=false)／額外寶袋(isExtra=true)／孤立(來源牌位已封存/查無)／
 * 重複(同一 sourceEntryId 有多個未刪除的預設寶袋)。
 *
 *   npx tsx scripts/auditPocket115.ts
 */
import { prisma } from "../src/lib/prisma";
const YEAR = 115;
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

type Row = {
  id: string; sourceEntryId: string; isExtra: boolean; quantity: number; registrationItemId: string | null;
  status: string; deletedAt: Date | null; createdAt: Date;
  tabletName: string | null; entryDeleted: Date | null; category: string | null;
  regSource: string | null; rrDeleted: Date | null; ro: number | null; regKey: string | null;
};

async function main() {
  console.log(`=== V36.4A 115 普渡寶袋逐筆對帳（唯讀）===\n`);

  const rows = await q<Row>(
    `SELECT api."id", api."sourceEntryId", api."isExtra", api."quantity", api."registrationItemId",
            api."status"::text AS status, api."deletedAt", api."createdAt",
            e."displayName" AS "tabletName", e."deletedAt" AS "entryDeleted", e."category"::text AS category,
            rr."registrationSource" AS "regSource", rr."deletedAt" AS "rrDeleted",
            reg."registrationOrder" AS ro, regtype."key" AS "regKey"
     FROM "additional_print_items" api
     LEFT JOIN "universal_salvation_entries" e ON e."id" = api."sourceEntryId"
     LEFT JOIN "ritual_records" rr ON rr."id" = api."ritualRecordId"
     LEFT JOIN "ritual_registration_items" reg ON reg."id" = api."registrationItemId"
     LEFT JOIN "registration_item_types" regtype ON regtype."id" = reg."registrationItemTypeId"
     WHERE api."itemType"::text='POCKET' AND api."deletedAt" IS NULL
       AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
     ORDER BY api."isExtra", e."category", api."createdAt"`);

  // 重複偵測：同一 sourceEntryId 的預設寶袋（isExtra=false）超過一個。
  const defaultBySource = new Map<string, number>();
  for (const r of rows) if (!r.isExtra) defaultBySource.set(r.sourceEntryId, (defaultBySource.get(r.sourceEntryId) ?? 0) + 1);

  const classify = (r: Row) => {
    const orphan = r.entryDeleted != null || r.tabletName == null || r.rrDeleted != null;
    const dup = !r.isExtra && (defaultBySource.get(r.sourceEntryId) ?? 0) > 1;
    return { orphan, dup };
  };

  console.log(`共 ${rows.length} 個未刪除 POCKET\n`);
  console.log(`id | 牌位名稱 | sourceEntryId | isExtra | qty | registrationItemId | regOrder | status | deletedAt | 建立時間 | 來源 | Excel額外 | 基本 | 孤立/重複`);
  for (const r of rows) {
    const { orphan, dup } = classify(r);
    const flags = [orphan ? "孤立(來源牌位已封存/查無)" : "", dup ? "重複(同來源多個預設)" : "", r.regKey && r.regKey !== "US_POCKET_EXTRA" ? `regKey=${r.regKey}?` : ""].filter(Boolean).join("；") || "正常";
    console.log(
      `${r.id} | ${r.tabletName ?? "（來源已刪/查無）"} | ${r.sourceEntryId} | ${r.isExtra} | ${r.quantity} | ${r.registrationItemId ?? "—"} | ${r.ro ?? "—"} | ${r.status} | ${r.deletedAt ? new Date(r.deletedAt).toISOString() : "null"} | ${new Date(r.createdAt).toISOString()} | ${r.regSource ?? "—"} | ${r.isExtra ? "是" : "否"} | ${!r.isExtra ? "是" : "否"} | ${flags}`
    );
  }

  // 統計
  const basic = rows.filter((r) => !r.isExtra);
  const extra = rows.filter((r) => r.isExtra);
  const orphans = rows.filter((r) => classify(r).orphan);
  const dups = rows.filter((r) => classify(r).dup);
  const basicHealthy = basic.filter((r) => !classify(r).orphan && !classify(r).dup);

  console.log(`\n════════ 統計 ════════`);
  console.log(`基本寶袋(isExtra=false) 總數：${basic.length}（其中健康 ${basicHealthy.length}、孤立 ${basic.filter((r) => classify(r).orphan).length}、重複 ${dups.length}）`);
  console.log(`額外寶袋(isExtra=true) 總數：${extra.length}`);
  console.log(`孤立寶袋（來源牌位已封存/查無）：${orphans.length}`);
  console.log(`重複預設寶袋：${dups.length}`);

  const surplus = [...orphans, ...dups];
  console.log(`\n──「多出的那一個」候選（孤立＋重複）：${surplus.length} 個 ──`);
  for (const r of surplus) {
    console.log(`  api ${r.id}｜牌位 ${r.tabletName ?? "(來源已封存/查無)"}｜sourceEntryId ${r.sourceEntryId}｜isExtra=${r.isExtra}｜建立 ${new Date(r.createdAt).toISOString()}｜來源 ${r.regSource ?? "—"}｜${classify(r).orphan ? "來源牌位已封存/查無（孤立）" : "重複"}`);
  }
  console.log(`\n理論：基本 49 ＋ 額外 1 = 50。實際健康基本 ${basicHealthy.length} ＋ 額外 ${extra.length} = ${basicHealthy.length + extra.length}；孤立/重複 ${surplus.length} 個即為多出來源。`);
  console.log(`\n（唯讀對帳結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
