/**
 * 陳永成重複乙位正魂：重新封存指定的那一筆（dry-run 預設；--commit 才執行）。
 *
 *   保留（不碰）：cmsdciunt001rec1ttokavbhn
 *   重新封存    ：cmsdciutj0025ec1tpfurli2b
 *
 * 走既有正式流程 deleteUniversalSalvationEntry()：連動取消**未收款** RRI、軟刪其預設 TABLET／
 * 基本 POCKET（V34.3B 連動）。不硬刪、不碰另一筆、不動財務。
 * 安全前置檢查（任一不符即中止、絕不寫入）：
 *   - 目標 entry 存在、未封存、category=INDIVIDUAL_SOUL、名稱含「陳永成」。
 *   - 其關聯 RRI amountPaid = 0；預設 TABLET／POCKET printCount = 0。
 *   - 無任何財務足跡（payment_allocations／receipt_lines 參照其 RRI）。
 *   - 保留那一筆存在且不會被觸及。
 *
 *   npx tsx scripts/reArchiveChenYongchengDuplicate.ts            # Dry-Run
 *   npx tsx scripts/reArchiveChenYongchengDuplicate.ts --commit   # 正式封存
 */
import { prisma } from "../src/lib/prisma";
import { deleteUniversalSalvationEntry } from "../src/lib/ritual";

const KEEP_ID = "cmsdciunt001rec1ttokavbhn";
const DELETE_ID = "cmsdciutj0025ec1tpfurli2b";
const YEAR = 115;
const OPERATOR = "系統：陳永成重複牌位重新封存";
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`=== 陳永成重複牌位重新封存（${commit ? "COMMIT" : "DRY-RUN"}）===`);
  console.log(`保留：${KEEP_ID}\n封存：${DELETE_ID}\n`);

  const info = async (id: string) => (await q<{ eid: string; disp: string; cat: string; del: Date | null; hh: string; year: number; act: string }>(
    `SELECT e."id" AS eid, e."displayName" AS disp, e."category"::text AS cat, e."deletedAt" AS del,
            rr."householdId" AS hh, rr."year" AS year, rr."activityType"::text AS act
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId" WHERE e."id"=$1`, id))[0];

  const del = await info(DELETE_ID);
  const keep = await info(KEEP_ID);
  const abort = (msg: string) => { console.error(`\n✗ 中止：${msg}`); process.exit(2); };

  if (!del) abort(`找不到要封存的 entry ${DELETE_ID}`);
  if (!keep) abort(`找不到要保留的 entry ${KEEP_ID}`);
  console.log(`要封存：${del.disp}｜category=${del.cat}｜家戶=${del.hh}｜${del.act}/${del.year}｜deletedAt=${del.del ? "已封存" : "未封存"}`);
  console.log(`要保留：${keep.disp}｜category=${keep.cat}｜家戶=${keep.hh}｜deletedAt=${keep.del ? "已封存" : "未封存"}`);

  if (del.del) abort("目標 entry 已是封存狀態，無需再封存");
  if (del.cat !== "INDIVIDUAL_SOUL") abort(`目標 entry 類別=${del.cat}，非乙位正魂`);
  if (!del.disp.includes("陳永成")) abort(`目標 entry 名稱「${del.disp}」不含「陳永成」`);
  if (del.act !== "UNIVERSAL_SALVATION" || del.year !== YEAR) abort(`目標 entry 非 ${YEAR} 普渡`);
  if ((DELETE_ID as string) === (KEEP_ID as string)) abort("保留與封存為同一 id");

  // RRI amountPaid / 財務足跡
  const rris = await q<{ id: string; status: string; paid: string; del: Date | null }>(
    `SELECT "id","status"::text AS status,"amountPaid" AS paid,"deletedAt" AS del FROM "ritual_registration_items" WHERE "universalSalvationEntryId"=$1`, DELETE_ID);
  const rriIds = rris.map((r) => r.id);
  const inList = rriIds.length ? rriIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : null;
  const paidSum = rris.reduce((s, r) => s + (Number(r.paid) || 0), 0);
  const alloc = inList ? Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${inList})`))[0]?.n ?? 0) : 0;
  const rl = inList ? Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${inList})`))[0]?.n ?? 0) : 0;

  // 預設 TABLET／基本 POCKET printCount
  const objs = await q<{ id: string; itemType: string; isExtra: boolean; printCount: number; del: Date | null }>(
    `SELECT "id","itemType"::text AS "itemType","isExtra","printCount","deletedAt" AS del FROM "additional_print_items" WHERE "sourceEntryId"=$1`, DELETE_ID);
  const defaults = objs.filter((o) => !o.isExtra && !o.del);
  const maxPrint = Math.max(0, ...objs.map((o) => Number(o.printCount) || 0));

  console.log(`\n── 安全檢查（僅影響此 entry 及其關聯）──`);
  console.log(`關聯 RRI：${rris.length} 筆（${rris.map((r) => `${r.id.slice(-6)}:${r.status}:已收${r.paid}`).join("、") || "無"}）｜amountPaid 合計=${paidSum}`);
  console.log(`預設列印物件（isExtra=false）：${defaults.map((o) => `${o.itemType}:printCount=${o.printCount}`).join("、") || "無"}｜最大 printCount=${maxPrint}`);
  console.log(`額外寶袋（isExtra=true，不受此封存連動）：${objs.filter((o) => o.isExtra && !o.del).length} 個`);
  console.log(`財務足跡：payment_allocations=${alloc}｜receipt_lines=${rl}`);

  if (paidSum !== 0) abort(`amountPaid=${paidSum}≠0，禁止封存`);
  if (maxPrint !== 0) abort(`printCount=${maxPrint}≠0，禁止封存`);
  if (alloc + rl > 0) abort(`偵測到財務足跡（分配 ${alloc}／收據行 ${rl}），禁止封存`);
  console.log(`✓ amountPaid=0、printCount=0、無財務足跡 → 可安全封存。`);

  console.log(`\n將執行 deleteUniversalSalvationEntry("${del.hh}", ${YEAR}, "${DELETE_ID}")：`);
  console.log(`  - 軟刪 entry ${DELETE_ID}`);
  console.log(`  - 連動取消其未收款 RRI（cancelLinkedTabletItem，已收款則保留）`);
  console.log(`  - 連動軟刪其預設 TABLET／基本 POCKET 列印物件（V34.3B）`);
  console.log(`  - 不觸及保留的 ${KEEP_ID}、不硬刪、不動財務`);

  if (!commit) { console.log(`\nDRY-RUN 結束，未寫入。確認上列數字後加 --commit 執行。`); return; }

  const res = await deleteUniversalSalvationEntry(del.hh, YEAR, DELETE_ID, OPERATOR);
  if (!res.ok) abort(`deleteUniversalSalvationEntry 失敗：${res.error}`);

  // 事後驗證：目標已封存、保留仍在。
  const delAfter = await info(DELETE_ID);
  const keepAfter = await info(KEEP_ID);
  console.log(`\n✓ COMMIT 完成。`);
  console.log(`  封存 ${DELETE_ID}：deletedAt=${delAfter?.del ? "已封存 ✓" : "⚠ 仍未封存"}`);
  console.log(`  保留 ${KEEP_ID}：deletedAt=${keepAfter?.del ? "⚠ 竟被封存！" : "未封存（未受影響）✓"}`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
