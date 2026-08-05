/**
 * V36.12 修正「tabletAddress 被凍結成別戶地址」的既有牌位（Dry-Run／Commit）。
 *
 * 只挑**明確別戶**的牌位（強訊號，不猜）：entry.tabletAddress 目前的值
 *   (a) 等於該列印物件 memberId 對應信眾的地址、且該信眾家戶 ≠ 牌位家戶（跨戶快照）；或
 *   (b) 命中「其他家戶」的 Household.address。
 * 修正為**本戶**地址：優先 Excel 匯入原始地址（可追溯且本戶）→ 否則本戶 Household.address。
 * 找不到本戶可信地址則略過（不亂填、留待人工）。
 *
 * 只更新 universal_salvation_entries.tabletAddress；不動名稱／陽上／收款／列印物件／匯入。
 *
 *   npx tsx scripts/fixTabletAddressCrossHousehold115.ts            # Dry-Run（預設，不寫入）
 *   npx tsx scripts/fixTabletAddressCrossHousehold115.ts --commit   # 正式修正
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";

const YEAR = 115;
const OPERATOR = "系統：V36.12 別戶地址修正";
const TABLET_CATS = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);
const SUFFIXES = ["歷代祖先", "乙位正魂", "無緣子女", "累世冤親債主", "歷世冤親債主", "冤親債主", "冤親"];

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }
const inList = (xs: string[]) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s　 ​-‍⁠﻿]/g, "").trim();
function core(cat: string, disp: string): string {
  let s = norm(disp);
  for (const suf of SUFFIXES) if (s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  if (cat === "ANCESTOR_LINE" && s.endsWith("姓")) s = s.slice(0, -1);
  return s;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const views = (await listPrintItemsForPrintCenter(YEAR, {})).filter((v) => v.itemType === "TABLET" && TABLET_CATS.has(v.sourceCategory));
  const entryIds = [...new Set(views.map((v) => v.sourceEntryId))];
  console.log(`=== V36.12 別戶地址修正（${commit ? "COMMIT" : "DRY-RUN"}）｜有效牌位 ${views.length} 筆 ===\n`);
  if (!entryIds.length) { console.log("無資料。"); return; }

  const entries = await q<{ id: string; cat: string; disp: string; ta: string | null; hh: string }>(
    `SELECT e."id", e."category"::text cat, e."displayName" disp, e."tabletAddress" ta, rr."householdId" hh
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId" WHERE e."id" IN (${inList(entryIds)})`);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const hhIds = [...new Set(entries.map((e) => e.hh))];
  const hhs = await q<{ id: string; addr: string | null }>(`SELECT "id","address" AS addr FROM "households" WHERE "id" IN (${inList(hhIds)})`);
  const hhAddrById = new Map(hhs.map((h) => [h.id, h.addr]));
  // 全庫家戶地址（偵測「命中別戶家戶地址」）——只需 id↔address 對照。
  const allHh = await q<{ id: string; addr: string | null }>(`SELECT "id","address" AS addr FROM "households" WHERE "address" IS NOT NULL`);
  const hhIdByAddr = new Map<string, string>();
  for (const h of allHh) if (norm(h.addr)) if (!hhIdByAddr.has(norm(h.addr))) hhIdByAddr.set(norm(h.addr), h.id);

  const objRows = await q<{ id: string; mid: string | null }>(`SELECT "id","memberId" AS mid FROM "additional_print_items" WHERE "id" IN (${inList(views.map((v) => v.id))})`);
  const memberIdByObj = new Map(objRows.map((r) => [r.id, r.mid]));
  const memberIds = [...new Set(objRows.map((r) => r.mid).filter((x): x is string => !!x))];
  const mems = memberIds.length ? await q<{ id: string; hh: string; addr: string | null }>(`SELECT "id","householdId" AS hh,"address" AS addr FROM "members" WHERE "id" IN (${inList(memberIds)})`) : [];
  const memById = new Map(mems.map((m) => [m.id, m]));

  // Excel 原始地址（本戶＋類別＋核心名）。
  const excelRows = await q<{ hh: string | null; cat: string | null; tname: string | null; taddr: string | null }>(
    `SELECT r."matchedHouseholdId" hh,
            COALESCE(r."editedData"->>'tabletCategory', r."normalizedData"->>'tabletCategory') cat,
            COALESCE(r."editedData"->>'tabletName', r."normalizedData"->>'tabletName') tname,
            COALESCE(r."editedData"->>'tabletAddress', r."normalizedData"->>'tabletAddress') taddr
     FROM "purification_import_rows" r JOIN "purification_import_batches" b ON b."id"=r."batchId" WHERE b."year"=${YEAR}`);
  const excelByKey = new Map<string, string>();
  for (const r of excelRows) {
    if (!r.hh || !r.cat || !norm(r.taddr)) continue;
    const key = `${r.hh}|${r.cat}|${core(r.cat, r.tname ?? "")}`;
    if (!excelByKey.has(key)) excelByKey.set(key, (r.taddr ?? "").trim());
  }

  const plans: { id: string; cat: string; disp: string; hh: string; oldAddr: string; newAddr: string; reason: string; via: string }[] = [];
  const skipped: { id: string; disp: string; hh: string; oldAddr: string; reason: string }[] = [];

  for (const v of views) {
    const e = entryById.get(v.sourceEntryId);
    if (!e) continue;
    const ta = norm(e.ta);
    if (!ta) continue; // 空白不在本腳本範圍（本腳本只修「別戶誤植」）。
    const mid = memberIdByObj.get(v.id) ?? null;
    const mem = mid ? memById.get(mid) : null;

    const crossMember = mem && mem.hh !== e.hh && norm(mem.addr) === ta;         // (a) 跨戶 member 快照
    const otherHh = hhIdByAddr.has(ta) && hhIdByAddr.get(ta) !== e.hh;           // (b) 命中別戶家戶地址
    if (!crossMember && !otherHh) continue;                                       // 非別戶 → 不動

    const reason = crossMember ? `tabletAddress＝跨戶信眾地址（信眾家戶 ${mem!.hh}≠牌位家戶 ${e.hh}）` : `tabletAddress 命中別戶家戶 ${hhIdByAddr.get(ta)} 之地址`;
    const excel = excelByKey.get(`${e.hh}|${e.cat}|${core(e.cat, e.disp)}`);
    const hhAddr = hhAddrById.get(e.hh);
    let newAddr: string | null = null, via = "";
    if (excel && norm(excel) !== ta) { newAddr = excel; via = "Excel 原始（本戶）"; }
    else if (norm(hhAddr) && norm(hhAddr) !== ta) { newAddr = (hhAddr ?? "").trim(); via = "本戶 Household.address"; }

    if (!newAddr) { skipped.push({ id: e.id, disp: v.sourceDisplayName, hh: e.hh, oldAddr: e.ta ?? "", reason: `${reason}；但本戶查無可信替代地址 → 略過待人工` }); continue; }
    plans.push({ id: e.id, cat: e.cat, disp: v.sourceDisplayName, hh: e.hh, oldAddr: e.ta ?? "", newAddr, reason, via });
  }

  for (const p of plans) {
    console.log(`⚠ ${p.cat}｜${p.disp}｜家戶 ${p.hh}｜entryId=${p.id}`);
    console.log(`   原因：${p.reason}`);
    console.log(`   地址：「${p.oldAddr}」→「${p.newAddr}」（來源：${p.via}）\n`);
  }
  if (skipped.length) {
    console.log(`── 偵測到別戶但無可信替代（略過，待人工）：${skipped.length} 筆 ──`);
    for (const s of skipped) console.log(`   · ${s.disp}｜家戶 ${s.hh}｜現值「${s.oldAddr}」｜${s.reason}`);
    console.log("");
  }
  console.log(`── 摘要 ──\n可修正：${plans.length} 筆；別戶但略過：${skipped.length} 筆。`);

  if (!commit) { console.log(`\nDRY-RUN 結束，未寫入。確認上列 old→new 後加 --commit 執行。`); return; }

  for (const p of plans) {
    await prisma.universalSalvationEntry.update({ where: { id: p.id }, data: { tabletAddress: p.newAddr } });
    console.log(`  ✓ 已更新 ${p.id} tabletAddress → 「${p.newAddr}」`);
  }
  console.log(`\n✓ COMMIT 完成（${plans.length} 筆）。操作：${OPERATOR}。請於 Mac 重新整理列印預覽確認地址。`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
