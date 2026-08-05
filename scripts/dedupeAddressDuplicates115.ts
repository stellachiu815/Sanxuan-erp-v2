/**
 * V36.10 已確認的 5 組補地址重複牌位清理（單一 Dry-Run／Commit）。
 *
 * ⚠️ 本腳本**只**處理下列 5 組**固定 entryId 配對**，保留／封存方向由人工指定、**不做**任何
 *    全資料自動比對，也**不**依足跡自動翻轉方向（避免把合法的同名不同址牌位誤判合併）。
 *
 * 每組封存前，逐項硬性檢查（任一不符 → 整批立即中止、絕不寫入）：
 *   被封存者：amountPaid=0、printCount=0、無 receipt_lines、無 payment_allocations、且目前未封存。
 *   保留者　：地址（tabletAddress）有值、陽上人（yangshangNames）有值、WorshipRecord 關聯存在、且未封存。
 *   兩者同家戶、同類別、同一年度（115 普渡）、非同一 id。
 *
 * 正式封存只走既有正式流程 deleteUniversalSalvationEntry()（連動取消未收款 RRI、軟刪其預設
 * TABLET／基本 POCKET）。不硬刪、不動財務、不碰額外寶袋（含江士耀）、不改匯入比對規則。
 *
 *   npx tsx scripts/dedupeAddressDuplicates115.ts            # Dry-Run（預設，不寫入）
 *   npx tsx scripts/dedupeAddressDuplicates115.ts --commit   # 正式執行
 */
import { prisma } from "../src/lib/prisma";
import { deleteUniversalSalvationEntry } from "../src/lib/ritual";

const YEAR = 115;
const OPERATOR = "系統：V36.10 補地址重複牌位清理";

type Pair = { label: string; category: string; keepId: string; archiveId: string };
const PAIRS: Pair[] = [
  { label: "祖先·張姓",   category: "ANCESTOR_LINE",   keepId: "cmser371v0046e01sm9pgl5ho", archiveId: "cmse81ys50041fd1sqqqm8mif" },
  { label: "祖先·劉姓",   category: "ANCESTOR_LINE",   keepId: "cmser36g6003he01skf3w970i", archiveId: "cmsdjya1j00d0fv1sdlzm8avs" },
  { label: "乙位·詹淯慧", category: "INDIVIDUAL_SOUL", keepId: "cmser36ln003te01sdt3vu4zn", archiveId: "cmsdjya9500defv1s4sy8jxug" },
  { label: "乙位·林錦輝", category: "INDIVIDUAL_SOUL", keepId: "cmser36a40035e01sg0km3dgu", archiveId: "cmsdjy9kz00bifv1s7smf8dpy" },
  { label: "乙位·林阿梅", category: "INDIVIDUAL_SOUL", keepId: "cmser364h002te01sxb2rtgvu", archiveId: "cmsdjy9fk00b4fv1s5nu8m66p" },
];

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

type EntryInfo = {
  id: string; category: string; displayName: string; tabletAddress: string | null;
  yangshang: string[]; worshipRecordId: string | null; deletedAt: Date | null;
  householdId: string; year: number; activityType: string;
  rriCount: number; amountPaidSum: number; maxPrintCount: number; allocations: number; receiptLines: number;
};

async function loadEntry(id: string): Promise<EntryInfo | null> {
  const base = (await q<{
    id: string; category: string; disp: string; addr: string | null; ya: string[] | null;
    wr: string | null; del: Date | null; hh: string; year: number; act: string;
  }>(
    `SELECT e."id", e."category"::text AS category, e."displayName" AS disp, e."tabletAddress" AS addr,
            e."yangshangNames" AS ya, e."worshipRecordId" AS wr, e."deletedAt" AS del,
            rr."householdId" AS hh, rr."year" AS year, rr."activityType"::text AS act
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId" WHERE e."id"=$1`, id))[0];
  if (!base) return null;

  const rris = await q<{ id: string; paid: string }>(
    `SELECT "id","amountPaid" AS paid FROM "ritual_registration_items" WHERE "universalSalvationEntryId"=$1`, id);
  const rriIds = rris.map((r) => r.id);
  const inList = rriIds.length ? rriIds.map((s) => `'${s.replace(/'/g, "''")}'`).join(",") : null;
  const amountPaidSum = rris.reduce((s, r) => s + (Number(r.paid) || 0), 0);
  const allocations = inList ? Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "payment_allocations" WHERE "sourceId" IN (${inList})`))[0]?.n ?? 0) : 0;
  const receiptLines = inList ? Number((await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM "receipt_lines" WHERE "sourceId" IN (${inList})`))[0]?.n ?? 0) : 0;

  const objs = await q<{ pc: number }>(
    `SELECT "printCount" AS pc FROM "additional_print_items" WHERE "sourceEntryId"=$1 AND "isExtra"=false`, id);
  const maxPrintCount = Math.max(0, ...objs.map((o) => Number(o.pc) || 0));

  return {
    id: base.id, category: base.category, displayName: base.disp, tabletAddress: base.addr,
    yangshang: base.ya ?? [], worshipRecordId: base.wr, deletedAt: base.del,
    householdId: base.hh, year: base.year, activityType: base.act,
    rriCount: rris.length, amountPaidSum, maxPrintCount, allocations, receiptLines,
  };
}

function fmt(e: EntryInfo): string {
  return `${e.id}｜${e.displayName}｜地址=${e.tabletAddress ?? "（空）"}｜陽上人=[${e.yangshang.join("、")}]｜WorshipRecord=${e.worshipRecordId ? "有" : "無"}` +
    `｜deletedAt=${e.deletedAt ? "已封存" : "未封存"}｜RRI=${e.rriCount}／已收${e.amountPaidSum}｜maxPrintCount=${e.maxPrintCount}｜分配=${e.allocations}／收據行=${e.receiptLines}`;
}

async function main() {
  const commit = process.argv.includes("--commit");
  console.log(`=== V36.10 補地址重複牌位清理（${commit ? "COMMIT" : "DRY-RUN"}）｜固定 5 組、人工指定方向 ===\n`);

  const fail: string[] = [];
  const ready: { pair: Pair; keep: EntryInfo; archive: EntryInfo }[] = [];

  for (const p of PAIRS) {
    console.log(`── ${p.label} ──`);
    const keep = await loadEntry(p.keepId);
    const archive = await loadEntry(p.archiveId);
    if (!keep) { fail.push(`${p.label}：找不到保留 entry ${p.keepId}`); console.error(`  ✗ 找不到保留 ${p.keepId}`); continue; }
    if (!archive) { fail.push(`${p.label}：找不到封存 entry ${p.archiveId}`); console.error(`  ✗ 找不到封存 ${p.archiveId}`); continue; }
    console.log(`  保留：${fmt(keep)}`);
    console.log(`  封存：${fmt(archive)}`);

    const bad: string[] = [];
    // 一致性
    if (keep.id === archive.id) bad.push("保留與封存為同一 id");
    if (keep.householdId !== archive.householdId) bad.push(`不同家戶（${keep.householdId}≠${archive.householdId}）`);
    for (const [tag, e] of [["保留", keep], ["封存", archive]] as const) {
      if (e.category !== p.category) bad.push(`${tag}類別=${e.category}≠${p.category}`);
      if (e.activityType !== "UNIVERSAL_SALVATION" || e.year !== YEAR) bad.push(`${tag}非 ${YEAR} 普渡`);
    }
    // 被封存者：零財務／零列印足跡、且未封存
    if (archive.deletedAt) bad.push("被封存者已是封存狀態");
    if (archive.amountPaidSum !== 0) bad.push(`被封存者 amountPaid=${archive.amountPaidSum}≠0`);
    if (archive.maxPrintCount !== 0) bad.push(`被封存者 printCount=${archive.maxPrintCount}≠0`);
    if (archive.receiptLines !== 0) bad.push(`被封存者 receipt_lines=${archive.receiptLines}≠0`);
    if (archive.allocations !== 0) bad.push(`被封存者 payment_allocations=${archive.allocations}≠0`);
    // 保留者：資料完整、未封存
    if (keep.deletedAt) bad.push("保留者已封存");
    if (!keep.tabletAddress || !keep.tabletAddress.trim()) bad.push("保留者無地址");
    if (keep.yangshang.length === 0) bad.push("保留者無陽上人");
    if (!keep.worshipRecordId) bad.push("保留者無 WorshipRecord 關聯");

    if (bad.length) { fail.push(`${p.label}：${bad.join("；")}`); console.error(`  ✗ 不通過：${bad.join("；")}\n`); continue; }
    console.log(`  ✓ 安全檢查通過：封存者零足跡、保留者資料完整。\n`);
    ready.push({ pair: p, keep, archive });
  }

  if (fail.length) {
    console.error(`\n✗ 有 ${fail.length} 組未通過安全檢查，整批立即中止、未寫入：`);
    for (const f of fail) console.error(`   - ${f}`);
    process.exit(2);
  }

  console.log(`\n── 摘要 ──`);
  console.log(`5 組全部通過安全檢查，可安全封存（軟刪）。`);
  console.log(`預期修正後名冊：祖先 34、乙位 13、冤親 2、寶袋 50。`);

  if (!commit) {
    console.log(`\nDRY-RUN 結束，未寫入。確認上列後加 --commit 執行。`);
    return;
  }

  for (const r of ready) {
    const res = await deleteUniversalSalvationEntry(r.archive.householdId, YEAR, r.archive.id, OPERATOR);
    if (!res.ok) { console.error(`  ✗ 封存 ${r.archive.id} 失敗：${res.error}`); process.exit(1); }
    const after = await loadEntry(r.archive.id);
    console.log(`  ✓ ${r.pair.label}：封存 ${r.archive.id}（deletedAt=${after?.deletedAt ? "已封存 ✓" : "⚠ 仍未封存"}）｜保留 ${r.keep.id}`);
  }
  console.log(`\n✓ COMMIT 完成。請於 Mac 重新整理列印名冊確認：祖先 34、乙位 13、冤親 2、寶袋 50。`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
