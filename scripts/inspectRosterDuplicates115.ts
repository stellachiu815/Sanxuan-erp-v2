/**
 * 檢查 buildItemRoster() 普渡名冊列——印出每列 entryId / printObjectId / registrationItemId，
 * 並找出重複的 entryId 與原因（不同 printObject？還是同一 printObject 被 push 兩次？）。唯讀。
 *
 *   npx tsx scripts/inspectRosterDuplicates115.ts              # 全部普渡 key
 *   npx tsx scripts/inspectRosterDuplicates115.ts --key=US_ANCESTOR
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";
import { buildItemRoster } from "../src/lib/printDocuments";

const YEAR = 115;
const KEYS = ["US_ANCESTOR", "US_ZHENGHUN", "US_YUANQIN", "US_WUYUAN", "US_POCKET_EXTRA"];
const CAT_OF: Record<string, string> = { US_ANCESTOR: "ANCESTOR_LINE", US_ZHENGHUN: "INDIVIDUAL_SOUL", US_YUANQIN: "DEBT_CREDITOR", US_WUYUAN: "UNBORN_CHILD" };

async function inspectKey(itemKey: string) {
  const isPocket = itemKey === "US_POCKET_EXTRA";
  const cat = CAT_OF[itemKey];
  const items = await listPrintItemsForPrintCenter(YEAR, {});
  const filtered = items.filter((i) => (isPocket ? i.itemType === "POCKET" : i.itemType === "TABLET" && i.sourceCategory === cat));

  // 對應 registrationItemId：牌位＝RRI(universalSalvationEntryId)；寶袋＝該列印物件自身 registrationItemId。
  const regByObject = new Map<string, string | null>();
  if (filtered.length) {
    if (isPocket) {
      const apiIds = filtered.map((i) => i.id);
      const rows = await prisma.$queryRawUnsafe<{ id: string; regId: string | null }[]>(
        `SELECT "id","registrationItemId" AS "regId" FROM "additional_print_items" WHERE "id" IN (${apiIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")})`);
      for (const r of rows) regByObject.set(r.id, r.regId);
    } else {
      const entryIds = [...new Set(filtered.map((i) => i.sourceEntryId))];
      const rows = await prisma.$queryRawUnsafe<{ eid: string; id: string }[]>(
        `SELECT "universalSalvationEntryId" AS eid, "id" FROM "ritual_registration_items"
         WHERE "universalSalvationEntryId" IN (${entryIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",")}) AND "deletedAt" IS NULL`);
      const rriByEntry = new Map(rows.map((r) => [r.eid, r.id]));
      for (const i of filtered) regByObject.set(i.id, rriByEntry.get(i.sourceEntryId) ?? null);
    }
  }

  console.log(`\n════════ ${itemKey}（filtered 列印物件 ${filtered.length} 筆）════════`);
  console.log(`entryId | printObjectId | registrationItemId | itemType | isExtra | printName`);
  for (const i of filtered) {
    console.log(`${i.sourceEntryId} | ${i.id} | ${regByObject.get(i.id) ?? "—"} | ${i.itemType} | ${i.isExtra} | ${i.printName}`);
  }

  // 重複 entryId 分析。
  const byEntry = new Map<string, typeof filtered>();
  for (const i of filtered) { const a = byEntry.get(i.sourceEntryId) ?? []; a.push(i); byEntry.set(i.sourceEntryId, a); }
  const dups = [...byEntry.entries()].filter(([, arr]) => arr.length > 1);
  console.log(`\n重複 entryId：${dups.length} 個`);
  for (const [eid, arr] of dups) {
    const objIds = arr.map((x) => x.id);
    const uniqueObj = new Set(objIds).size;
    const reason = uniqueObj === arr.length
      ? `不同 printObject（${arr.map((x) => `${x.itemType}${x.isExtra ? "/額外" : "/基本"}`).join(" + ")}）——${isPocket ? "基本＋額外寶袋屬正常" : "⚠ 同一牌位有多個列印物件（可能 dedupe 未收斂）"}`
      : `⚠ 同一 printObject id 出現多次（被 push 兩次，異常）`;
    console.log(`  entryId ${eid} 出現 ${arr.length} 次｜printObjectId：${objIds.join("、")}｜原因：${reason}`);
  }

  // 對照 buildItemRoster 實際輸出筆數。
  const roster = await buildItemRoster(itemKey, YEAR);
  console.log(`buildItemRoster(${itemKey}).rows = ${roster?.rows.length ?? "null"} 筆（entryId 唯一數＝${byEntry.size}）`);
}

async function main() {
  const keyArg = process.argv.find((a) => a.startsWith("--key="))?.slice(6);
  const keys = keyArg ? [keyArg] : KEYS;
  console.log(`=== buildItemRoster 普渡名冊重複 entryId 檢查（唯讀）===`);
  for (const k of keys) await inspectKey(k);
  console.log(`\n（唯讀檢查結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
