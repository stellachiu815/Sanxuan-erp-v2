/**
 * V36.7：V34 列印「ancestor-soul 應有 47 vs 實際 42」逐筆差集（唯讀，只 SELECT，不改資料/程式）。
 *
 * 沿用 print-v34 的同一條管線與同一批純函式，數字與畫面一致：
 *   A（應有）＝ listPrintItemsForPrintCenter(115,{}) 中 batchOf==='ancestor-soul' 的 TABLET 列印物件（不套完整度/未列印過濾）。
 *   B（實際進版型）＝ A 再套 print-v34 的過濾：isPrintableStatus && isUnprinted && isComplete。
 *   A − B ＝ 被排除者，逐筆標示真正原因（缺地址/缺陽上人/status/printCount/deletedAt/batch/其他）。
 * 另交叉核對「有效 ancestor-soul 牌位 entry」是否有牌位未進 A（→ 上游排除：封存/RRI取消/無列印物件）。
 *
 *   npx tsx scripts/auditV34AncestorSoulDiff115.ts
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";
import { batchOf, isPrintableStatus, isUnprinted, isComplete, type BatchItem } from "../src/lib/TabletBatchService";

const YEAR = 115;
const CAT: Record<string, string> = { ANCESTOR_LINE: "歷代祖先", INDIVIDUAL_SOUL: "乙位正魂", UNBORN_CHILD: "無緣子女" };
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  console.log(`=== V36.7 V34 ancestor-soul 47→42 逐筆差集（唯讀）===\n`);

  const items = (await listPrintItemsForPrintCenter(YEAR, {})) as unknown as (BatchItem & { sourceEntryId: string; sourceCategory: string; sourceDisplayName: string; sourceYangshangNames: string[]; household: { id: string; name: string } })[];
  const A = items.filter((i) => i.itemType === "TABLET" && batchOf(i) === "ancestor-soul");
  const B = A.filter((i) => isPrintableStatus(i.status) && isUnprinted(i) && isComplete(i));
  const excluded = A.filter((i) => !B.includes(i));

  // 每個牌位 entry 的 RRI 狀態 / RitualRecord 狀態 / entry.deletedAt（列印物件層 view 沒有）。
  const eids = [...new Set(A.map((i) => i.sourceEntryId))];
  const inList = eids.length ? eids.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : "''";
  const meta = await q<{ eid: string; edel: Date | null; rristatus: string | null; rrstatus: string | null }>(
    `SELECT e."id" AS eid, e."deletedAt" AS edel, rri."status"::text AS rristatus, rr."status"::text AS rrstatus
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     LEFT JOIN "ritual_registration_items" rri ON rri."universalSalvationEntryId"=e."id"
     WHERE e."id" IN (${inList})`);
  const metaBy = new Map(meta.map((m) => [m.eid, m]));

  const line = (i: typeof A[number]) => {
    const m = metaBy.get(i.sourceEntryId);
    return `entry ${i.sourceEntryId}｜${CAT[i.sourceCategory] ?? i.sourceCategory}｜${i.sourceDisplayName}｜家戶 ${i.household.id}｜陽上人 ${(i.sourceYangshangNames ?? []).join("、") || "（無）"}｜缺欄位 ${i.tabletMissingFields.join("／") || "—"}｜RRI=${m?.rristatus ?? "無"}｜RR=${m?.rrstatus ?? "?"}｜deletedAt=${m?.edel ? new Date(m.edel).toISOString() : "null"}｜printCount=${i.printCount}`;
  };

  console.log(`── A. 應列印（ancestor-soul TABLET 列印物件）：${A.length} 筆 ──`);
  for (const i of A) console.log("  " + line(i));

  console.log(`\n── B. V34 實際進版型：${B.length} 筆 ──`);
  for (const i of B) console.log("  " + line(i));

  console.log(`\n════════ 只存在 A、不存在 B：${excluded.length} 筆（逐筆原因）════════`);
  let n = 0;
  for (const i of excluded) {
    n++;
    const m = metaBy.get(i.sourceEntryId);
    const reasons: string[] = [];
    if (m?.edel) reasons.push("deletedAt（牌位已封存）");
    if (!isComplete(i)) reasons.push(`缺欄位：${i.tabletMissingFields.join("／")}`); // 例：牌位地址 / 陽上人
    if (!isPrintableStatus(i.status)) reasons.push(`列印物件 status=${i.status}（CANCELLED/PENDING_CONFIRMATION）`);
    if (!isUnprinted(i)) reasons.push(`printCount=${i.printCount}（已列印）`);
    if (m?.rristatus === "CANCELLED") reasons.push("關聯 RRI=CANCELLED");
    if (reasons.length === 0) reasons.push("其他（請檢視上列欄位）");
    console.log(`${n}. ${line(i)}`);
    console.log(`   → 排除真正原因：${reasons.join("；")}`);
  }

  // 交叉核對：有效 ancestor-soul 牌位 entry 是否有未出現在 A（上游排除）。
  const groundTruth = await q<{ eid: string; cat: string; disp: string; hh: string; edel: Date | null }>(
    `SELECT e."id" AS eid, e."category"::text AS cat, e."displayName" AS disp, rr."householdId" AS hh, e."deletedAt" AS edel
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     WHERE rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION' AND rr."deletedAt" IS NULL
       AND e."deletedAt" IS NULL AND e."category"::text IN ('ANCESTOR_LINE','INDIVIDUAL_SOUL','UNBORN_CHILD')`);
  const aEids = new Set(A.map((i) => i.sourceEntryId));
  const missingFromA = groundTruth.filter((g) => !aEids.has(g.eid));
  console.log(`\n── 交叉核對：有效 ancestor-soul 牌位 entry 共 ${groundTruth.length} 個；未進入 A（列印物件查詢）者 ${missingFromA.length} 個 ──`);
  for (const g of missingFromA) console.log(`  entry ${g.eid}｜${CAT[g.cat] ?? g.cat}｜${g.disp}｜家戶 ${g.hh} → 上游排除（無列印物件／RRI已取消／來源封存等，需個別確認）`);

  console.log(`\n統計：A=${A.length}｜B=${B.length}｜差 ${A.length - B.length}｜有效牌位 entry=${groundTruth.length}`);
  console.log(`（唯讀差集結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
