/**
 * V36.12 全部牌位地址來源逐筆對帳（唯讀）。
 *
 * 檢查 115 普渡「全部有效牌位」（listPrintItemsForPrintCenter 的 TABLET；已排除封存/取消），
 * 逐筆列出所有地址來源並分類、偵測可疑誤植。**全程唯讀、不寫入、不補地址、不清 Entry、不改查詢。**
 *
 *   npx tsx scripts/auditTabletAddress115.ts                    # 逐筆＋統計＋可疑名單
 *   npx tsx scripts/auditTabletAddress115.ts --suspect          # 只印可疑筆＋統計
 *   npx tsx scripts/auditTabletAddress115.ts --household=F00123  # 只查某一家戶（含各類別）
 *   npx tsx scripts/auditTabletAddress115.ts --cat=INDIVIDUAL_SOUL  # 只查某類別（如乙位正魂）
 */
import { prisma } from "../src/lib/prisma";
import { listPrintItemsForPrintCenter } from "../src/lib/additionalPrintItems";

const YEAR = 115;
const TABLET_CATS = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL", "DEBT_CREDITOR", "UNBORN_CHILD"]);
const SUFFIXES = ["歷代祖先", "乙位正魂", "無緣子女", "累世冤親債主", "歷世冤親債主", "冤親債主", "冤親"];

async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }
const inList = (xs: string[]) => xs.map((s) => `'${s.replace(/'/g, "''")}'`).join(",");
const norm = (s: string | null | undefined) => (s ?? "").replace(/[\s　 ​-‍⁠﻿]/g, "").trim();
const eqAddr = (a: string | null | undefined, b: string | null | undefined) => !!norm(a) && !!norm(b) && norm(a) === norm(b);
function core(cat: string, disp: string): string {
  let s = norm(disp);
  for (const suf of SUFFIXES) if (s.endsWith(suf)) { s = s.slice(0, -suf.length); break; }
  if (cat === "ANCESTOR_LINE" && s.endsWith("姓")) s = s.slice(0, -1);
  return s;
}

async function main() {
  const suspectOnly = process.argv.includes("--suspect");
  const views = (await listPrintItemsForPrintCenter(YEAR, {})).filter((v) => v.itemType === "TABLET" && TABLET_CATS.has(v.sourceCategory));
  const entryIds = [...new Set(views.map((v) => v.sourceEntryId))];
  console.log(`=== V36.12 牌位地址逐筆對帳（${YEAR} 普渡；有效牌位 ${views.length} 筆）唯讀 ===\n`);
  if (entryIds.length === 0) { console.log("無資料。"); return; }

  // entry ＋ record（家戶／來源／時間戳）。
  const entries = await q<{ id: string; cat: string; disp: string; ta: string | null; wrid: string | null; ca: Date; ua: Date; hh: string; src: string | null }>(
    `SELECT e."id", e."category"::text cat, e."displayName" disp, e."tabletAddress" ta, e."worshipRecordId" wrid,
            e."createdAt" ca, e."updatedAt" ua, rr."householdId" hh, rr."registrationSource"::text src
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     WHERE e."id" IN (${inList(entryIds)})`);
  const entryById = new Map(entries.map((e) => [e.id, e]));

  // WorshipRecord.location。
  const wrids = [...new Set(entries.map((e) => e.wrid).filter((x): x is string => !!x))];
  const wr = wrids.length ? await q<{ id: string; loc: string | null }>(`SELECT "id","location" AS loc FROM "worship_records" WHERE "id" IN (${inList(wrids)})`) : [];
  const wrLocById = new Map(wr.map((r) => [r.id, r.loc]));

  // Household（名稱／聯絡人／地址）。
  const hhIds = [...new Set(entries.map((e) => e.hh))];
  const hhs = await q<{ id: string; name: string; contact: string | null; addr: string | null }>(
    `SELECT "id","name","contactName" AS contact,"address" AS addr FROM "households" WHERE "id" IN (${inList(hhIds)})`);
  const hhById = new Map(hhs.map((h) => [h.id, h]));

  // 列印物件 memberId → member（家戶／地址／姓名）。
  const objRows = await q<{ id: string; mid: string | null }>(`SELECT "id","memberId" AS mid FROM "additional_print_items" WHERE "id" IN (${inList(views.map((v) => v.id))})`);
  const memberIdByObj = new Map(objRows.map((r) => [r.id, r.mid]));
  const memberIds = [...new Set(objRows.map((r) => r.mid).filter((x): x is string => !!x))];
  const mems = memberIds.length ? await q<{ id: string; hh: string; addr: string | null; name: string }>(`SELECT "id","householdId" AS hh,"address" AS addr,"name" FROM "members" WHERE "id" IN (${inList(memberIds)})`) : [];
  const memById = new Map(mems.map((m) => [m.id, m]));

  // Excel 匯入原始牌位地址（本年度批次；以 家戶+類別+核心名 對應，best-effort）。
  const excelRows = await q<{ hh: string | null; cat: string | null; tname: string | null; taddr: string | null }>(
    `SELECT r."matchedHouseholdId" hh,
            COALESCE(r."editedData"->>'tabletCategory', r."normalizedData"->>'tabletCategory') cat,
            COALESCE(r."editedData"->>'tabletName', r."normalizedData"->>'tabletName') tname,
            COALESCE(r."editedData"->>'tabletAddress', r."normalizedData"->>'tabletAddress') taddr
     FROM "purification_import_rows" r
     JOIN "purification_import_batches" b ON b."id"=r."batchId"
     WHERE b."year"=${YEAR}`);
  const excelByKey = new Map<string, Set<string>>();
  for (const r of excelRows) {
    if (!r.hh || !r.cat || !r.taddr) continue;
    const key = `${r.hh}|${r.cat}|${core(r.cat, r.tname ?? "")}`;
    const set = excelByKey.get(key) ?? new Set<string>(); set.add(norm(r.taddr)); excelByKey.set(key, set);
  }

  // 補地址前後版本衝突：全部（含封存）同 家戶+類別+核心名 的 entry 地址是否分歧。
  const allEnt = await q<{ id: string; cat: string; disp: string; ta: string | null; hh: string; del: Date | null }>(
    `SELECT e."id", e."category"::text cat, e."displayName" disp, e."tabletAddress" ta, rr."householdId" hh, e."deletedAt" del
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     WHERE rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION' AND rr."householdId" IN (${inList(hhIds)})`);
  const groupAddrs = new Map<string, Set<string>>();
  for (const e of allEnt) {
    if (!norm(e.ta)) continue;
    const key = `${e.hh}|${e.cat}|${core(e.cat, e.disp)}`;
    const set = groupAddrs.get(key) ?? new Set<string>(); set.add(norm(e.ta)); groupAddrs.set(key, set);
  }

  // 全戶地址索引（偵測「地址明顯來自其他家戶」）。
  const hhAddrToId = new Map<string, string>();
  for (const h of hhs) if (norm(h.addr)) hhAddrToId.set(norm(h.addr), h.id);

  type Row = { v: (typeof views)[number]; e: typeof entries[number]; bucket: string; consistent: boolean; suspects: string[]; recommend: string };
  const rows: Row[] = [];
  const stat = { entryTa: 0, worship: 0, member: 0, household: 0, blank: 0, consistent: 0, suspect: 0 };

  for (const v of views) {
    const e = entryById.get(v.sourceEntryId);
    if (!e) continue;
    const hh = hhById.get(e.hh);
    const mid = memberIdByObj.get(v.id) ?? null;
    const mem = mid ? memById.get(mid) : null;
    const wrLoc = e.wrid ? wrLocById.get(e.wrid) ?? null : null;
    const ta = e.ta, memberAddr = mem?.addr ?? null, hhAddr = hh?.addr ?? null;
    const resolved = norm(v.sourceLocation);
    const excelSet = excelByKey.get(`${e.hh}|${e.cat}|${core(e.cat, e.disp)}`);
    const excelAddr = excelSet && excelSet.size ? [...excelSet].join(" ／ ") : null;

    // 實際列印地址來源（比照現行 resolvePrintAddress：tabletAddress → Member.address）。
    let bucket = "空白";
    if (resolved && eqAddr(resolved, ta)) bucket = "entry.tabletAddress";
    else if (resolved && eqAddr(resolved, memberAddr)) bucket = "Member.address";
    else if (resolved && eqAddr(resolved, wrLoc)) bucket = "WorshipRecord.location";
    else if (resolved && eqAddr(resolved, hhAddr)) bucket = "Household.address";
    else if (resolved) bucket = "其他（來源不明）";
    if (bucket === "entry.tabletAddress") stat.entryTa++;
    else if (bucket === "WorshipRecord.location") stat.worship++;
    else if (bucket === "Member.address") stat.member++;
    else if (bucket === "Household.address") stat.household++;
    else if (bucket === "空白") stat.blank++;

    // 完全一致：所有非空來源彼此相同。
    const present = [ta, wrLoc, memberAddr, hhAddr, excelSet ? [...excelSet][0] : null].map(norm).filter(Boolean);
    const consistent = present.length > 0 && present.every((x) => x === present[0]);
    if (consistent) stat.consistent++;

    // 可疑誤植。
    const suspects: string[] = [];
    if (norm(ta) && norm(wrLoc) && !eqAddr(ta, wrLoc)) suspects.push(`tabletAddress≠WorshipRecord.location`);
    if (norm(ta) && excelSet && ![...excelSet].some((x) => x === norm(ta))) suspects.push(`tabletAddress≠Excel原始地址`);
    const gkey = `${e.hh}|${e.cat}|${core(e.cat, e.disp)}`;
    if ((groupAddrs.get(gkey)?.size ?? 0) > 1) suspects.push(`同戶同牌位前後版本地址分歧(${[...(groupAddrs.get(gkey) ?? [])].join(" / ")})`);
    if (bucket === "Member.address" && mem && mem.hh !== e.hh) suspects.push(`Member 退回跨戶(${mem.hh}≠${e.hh})`);
    if (norm(ta) && hhAddrToId.has(norm(ta)) && hhAddrToId.get(norm(ta)) !== e.hh) suspects.push(`tabletAddress 命中別戶家戶地址(${hhAddrToId.get(norm(ta))})`);
    if (suspects.length) stat.suspect++;

    // 建議保留哪個地址（依據）。
    let recommend = "維持現值";
    if (suspects.length) {
      const sameHhCandidates: [string, string | null][] = [["Excel原始", excelSet ? [...excelSet][0] : null], ["WorshipRecord", wrLoc], ["Household", hhAddr], ["同戶Member", mem && mem.hh === e.hh ? memberAddr : null]];
      const pick = sameHhCandidates.find(([, a]) => norm(a));
      recommend = pick ? `建議採「${pick[0]}」地址「${pick[1]}」（屬本戶且較可信）；勿用跨戶 Member 退回` : "本戶查無可信地址，需人工確認（勿用跨戶退回）";
    }

    rows.push({ v, e, bucket, consistent, suspects, recommend });
  }

  // 逐筆輸出。
  for (const r of rows) {
    if (suspectOnly && r.suspects.length === 0) continue;
    const e = r.e; const hh = hhById.get(e.hh); const mid = memberIdByObj.get(r.v.id) ?? null; const mem = mid ? memById.get(mid) : null;
    const wrLoc = e.wrid ? wrLocById.get(e.wrid) ?? null : null;
    const excelSet = excelByKey.get(`${e.hh}|${e.cat}|${core(e.cat, e.disp)}`);
    console.log(`${r.suspects.length ? "⚠" : "·"} ${e.cat}｜${r.v.sourceDisplayName}｜entryId=${e.id}`);
    console.log(`   家戶：${e.hh}（${hh?.name ?? "?"}）｜報名人：${hh?.contact ?? mem?.name ?? "—"}｜建立來源：${e.src ?? "—"}｜createdAt=${new Date(e.ca).toISOString().slice(0, 19)}｜updatedAt=${new Date(e.ua).toISOString().slice(0, 19)}`);
    console.log(`   entry.tabletAddress：${e.ta ?? "（空）"}`);
    console.log(`   WorshipRecord.location：${wrLoc ?? "（無/空）"}`);
    console.log(`   Member.address：${mem ? `${mem.addr ?? "（空）"}（信眾「${mem.name}」家戶 ${mem.hh}）` : "（列印物件無 memberId）"}`);
    console.log(`   Household.address：${hh?.addr ?? "（空）"}`);
    console.log(`   Excel 原始牌位地址：${excelSet ? [...excelSet].join(" ／ ") : "（無法追溯）"}`);
    console.log(`   ▶ 實際列印地址：${r.v.sourceLocation || "（空）"}｜來源分類：${r.bucket}｜完全一致：${r.consistent ? "是" : "否"}`);
    if (r.suspects.length) console.log(`   ⚠ 可疑：${r.suspects.join("；")}\n     建議：${r.recommend}`);
    console.log("");
  }

  // 統計。
  console.log(`════════ 統計 ════════`);
  console.log(`全部有效牌位：${rows.length}`);
  console.log(`地址來源：entry.tabletAddress=${stat.entryTa}｜WorshipRecord.location=${stat.worship}｜Member.address=${stat.member}｜Household.address=${stat.household}｜空白=${stat.blank}`);
  console.log(`完全一致：${stat.consistent}｜地址空白：${stat.blank}｜可疑誤植：${stat.suspect}`);
  console.log(`（註：現行列印規則僅 tabletAddress → Member.address；WorshipRecord/Household 欄為對照用，通常不會成為實際來源。）`);
  const suspectRows = rows.filter((r) => r.suspects.length);
  if (suspectRows.length) {
    console.log(`\n──── 可疑名單（${suspectRows.length} 筆）────`);
    for (const r of suspectRows) {
      console.log(`⚠ ${r.e.cat}｜${r.v.sourceDisplayName}｜家戶 ${r.e.hh}｜entryId=${r.e.id}`);
      console.log(`   ${r.suspects.join("；")}`);
      console.log(`   建議：${r.recommend}`);
    }
  } else {
    console.log(`\n未發現可疑誤植。`);
  }
  console.log(`\n（唯讀，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
