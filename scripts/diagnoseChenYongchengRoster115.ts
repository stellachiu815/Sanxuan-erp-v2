/**
 * V36.10 唯讀診斷：釐清「已封存牌位仍出現在 US_ZHENGHUN」的真正來源。
 * 逐筆比對下列兩個 entry，六個訊號並列輸出，**完全唯讀、不寫入任何資料**：
 *   - entry.deletedAt
 *   - 對應 AdditionalPrintItem（id / itemType / isExtra / deletedAt / printCount）
 *   - RRI（status / deletedAt / amountPaid）
 *   - 是否出現在 listPrintItemsForPrintCenter(115)
 *   - 是否出現在 buildItemRoster("US_ZHENGHUN", 115)
 *   - 是否出現在 getUniversalSalvationRosterExport(115)（並附「該 entry 的 RRI 是否符合匯出條件」的權威判定）
 *
 *   npx tsx scripts/diagnoseChenYongchengRoster115.ts
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";
import { buildItemRoster } from "../src/lib/printDocuments";
import { getUniversalSalvationRosterExport } from "../src/lib/universalSalvationRosterExport";

const YEAR = 115;
const IDS = ["cmsdciutj0025ec1tpfurli2b", "cmsdciunt001rec1ttokavbhn"];

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }
const yn = (b: boolean) => (b ? "是 ✅" : "否 ❌");

async function main() {
  console.log(`=== V36.10 唯讀診斷：陳永成兩筆 entry 於各名冊來源之現況（${YEAR} 普渡）===\n`);

  // 三個來源各查一次（與正式頁面同一支函式）。
  const printItems = await listPrintItemsForPrintCenter(YEAR, {});
  const roster = await buildItemRoster("US_ZHENGHUN", YEAR);
  const exportData = await getUniversalSalvationRosterExport(YEAR);
  const soulRows = exportData.sheets.ancestorSoul.rows; // 祖先＋乙位（含 typeName「乙位正魂」）

  console.log(`（來源筆數）listPrintItems=${printItems.length}｜buildItemRoster(US_ZHENGHUN).rows=${roster?.rows.length ?? "null"}｜匯出乙位計數=${exportData.counts.soul}\n`);

  for (const id of IDS) {
    console.log(`════════ entry ${id} ════════`);

    const entry = (await q<{ id: string; disp: string; cat: string; del: Date | null; ya: string[] | null }>(
      `SELECT e."id", e."displayName" AS disp, e."category"::text AS cat, e."deletedAt" AS del, e."yangshangNames" AS ya
       FROM "universal_salvation_entries" e WHERE e."id"=$1`, id))[0];
    if (!entry) { console.log(`  ⚠ 找不到此 entry\n`); continue; }
    console.log(`  entry：${entry.disp}｜category=${entry.cat}｜陽上人=[${(entry.ya ?? []).join("、")}]`);
    console.log(`  ① entry.deletedAt = ${entry.del ? `已封存（${new Date(entry.del).toISOString()}）` : "未封存"}`);

    // ② AdditionalPrintItem
    const objs = await q<{ id: string; it: string; ex: boolean; del: Date | null; pc: number }>(
      `SELECT "id","itemType"::text AS it,"isExtra" AS ex,"deletedAt" AS del,"printCount" AS pc
       FROM "additional_print_items" WHERE "sourceEntryId"=$1 ORDER BY "itemType","isExtra"`, id);
    console.log(`  ② AdditionalPrintItem（${objs.length} 筆）：`);
    for (const o of objs) console.log(`       ${o.id}｜${o.it}｜${o.ex ? "額外" : "預設"}｜deletedAt=${o.del ? "已軟刪" : "未刪"}｜printCount=${o.pc}`);
    if (objs.length === 0) console.log(`       （無）`);

    // ③ RRI（universalSalvationEntryId 為 1:1）
    const rri = (await q<{ id: string; st: string; del: Date | null; paid: string }>(
      `SELECT "id","status"::text AS st,"deletedAt" AS del,"amountPaid" AS paid
       FROM "ritual_registration_items" WHERE "universalSalvationEntryId"=$1`, id))[0];
    console.log(`  ③ RRI：${rri ? `${rri.id}｜status=${rri.st}｜deletedAt=${rri.del ? "已軟刪" : "未刪"}｜amountPaid=${rri.paid}` : "（無對應 RRI）"}`);

    // ④ listPrintItemsForPrintCenter
    const inPI = printItems.filter((i) => i.sourceEntryId === id);
    console.log(`  ④ 出現在 listPrintItemsForPrintCenter：${yn(inPI.length > 0)}${inPI.length ? `（${inPI.map((i) => `${i.itemType}:${i.id}`).join("、")}）` : ""}`);

    // ⑤ buildItemRoster(US_ZHENGHUN)：RosterRow.registrationItemId = 列印物件 id
    const objIds = new Set(objs.map((o) => o.id));
    const inRoster = (roster?.rows ?? []).filter((r) => objIds.has(r.registrationItemId));
    console.log(`  ⑤ 出現在 buildItemRoster(US_ZHENGHUN)：${yn(inRoster.length > 0)}${inRoster.length ? `（列 registrationItemId=${inRoster.map((r) => r.registrationItemId).join("、")}）` : ""}`);

    // ⑥ getUniversalSalvationRosterExport：權威判定＝該 entry 的 RRI 是否符合匯出 where（RRI CONFIRMED+未刪、record CONFIRMED+未刪）
    const eligible = (await q<{ id: string }>(
      `SELECT rri."id" FROM "ritual_registration_items" rri
       JOIN "ritual_records" rr ON rr."id"=rri."ritualRecordId"
       WHERE rri."universalSalvationEntryId"=$1
         AND rri."deletedAt" IS NULL AND rri."status"::text='CONFIRMED'
         AND rr."deletedAt" IS NULL AND rr."status"::text='CONFIRMED'
         AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'`, id)).length > 0;
    // 交叉核對：匯出乙位列中，名稱含此 entry displayName 的列數（同名可能不只一列，僅供參考）。
    const nameHits = soulRows.filter((row) => row.join("｜").includes(entry.disp)).length;
    console.log(`  ⑥ 出現在 getUniversalSalvationRosterExport：${yn(eligible)}（依 RRI 是否符合匯出條件判定）｜匯出乙位/祖先列中名稱含「${entry.disp}」者 ${nameHits} 列`);

    console.log("");
  }

  console.log(`── 判讀指引 ──`);
  console.log(`若 ①已封存、②預設物件已軟刪、④/⑤=否，但 ⑥=是 → 來源為「RRI-based 匯出未過濾 entry.deletedAt」（因 ③ RRI 仍 CONFIRMED/未刪，多為曾收款 amountPaid>0 而封存時保留）。`);
  console.log(`若 ④/⑤/⑥ 皆=否 → 所有查詢皆已排除，畫面仍見到即為舊 build／快取。`);
  console.log(`（本診斷全程唯讀，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
