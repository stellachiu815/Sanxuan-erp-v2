/**
 * V36.5A：陳永成「乙位正魂」重複牌位『真正根因』唯讀追查（只 SELECT，不修改/不刪除/不修正）。
 *
 * 逐筆列出每一筆陳永成乙位正魂牌位的完整建立跡證，供判定根因（不猜測）：
 *   建立時間、來源(registrationSource)、RitualRecord、RecordVersion(CREATE 操作人/changeNote)、
 *   對應的匯入草稿列(matchingStatus/resolutionAction/existingMatchStatus → 判 CREATE/UPDATE/SKIP/配對結果)、
 *   永久牌位(worshipRecordId)、牌位地址、陽上人、沿用去年(copiedFrom)。
 *
 *   npx tsx scripts/auditChenYongchengDuplicate.ts
 */
import { prisma } from "../src/lib/prisma";
const YEAR = 115;
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }

async function main() {
  console.log(`=== V36.5A 陳永成乙位正魂重複牌位追查（唯讀）===\n`);

  const entries = await q<{
    eid: string; disp: string; addr: string | null; wrid: string | null; ecreated: Date; deletedAt: Date | null;
    yang: string[] | null; rrid: string; regsrc: string | null; rrstatus: string; rrcreated: Date; hh: string; copiedFrom: string | null;
  }>(
    `SELECT e."id" AS eid, e."displayName" AS disp, e."tabletAddress" AS addr, e."worshipRecordId" AS wrid,
            e."createdAt" AS ecreated, e."deletedAt" AS "deletedAt", e."yangshangNames" AS yang,
            rr."id" AS rrid, rr."registrationSource" AS regsrc, rr."status"::text AS rrstatus, rr."createdAt" AS rrcreated,
            rr."householdId" AS hh, rr."copiedFromRitualRecordId" AS "copiedFrom"
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id"=e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id"=d."ritualRecordId"
     WHERE rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
       AND e."category"::text='INDIVIDUAL_SOUL' AND e."displayName" LIKE '%陳永成%'
     ORDER BY e."createdAt" ASC`);

  console.log(`找到 ${entries.length} 筆「陳永成乙位正魂」牌位（含已封存）\n`);

  let idx = 0;
  for (const e of entries) {
    idx++;
    console.log(`──────── 第 ${idx} 筆 ────────`);
    console.log(`entry.id            ：${e.eid}${e.deletedAt ? "（已封存）" : ""}`);
    console.log(`顯示名稱            ：${e.disp}`);
    console.log(`牌位地址            ：${e.addr ?? "（無）"}`);
    console.log(`陽上人              ：${(e.yang ?? []).join("、") || "（無）"}`);
    console.log(`永久牌位 worshipRecordId：${e.wrid ?? "（無，非同步自永久名單）"}`);
    console.log(`entry 建立時間       ：${new Date(e.ecreated).toISOString()}`);
    console.log(`RitualRecord         ：${e.rrid}｜狀態=${e.rrstatus}｜家戶=${e.hh}｜建立時間=${new Date(e.rrcreated).toISOString()}`);
    console.log(`建立來源 registrationSource：${e.regsrc ?? "（null）"}${e.copiedFrom ? `｜沿用去年 copiedFrom=${e.copiedFrom}` : ""}`);

    // 永久牌位內容
    if (e.wrid) {
      const wr = (await q<{ displayName: string; location: string | null; createdAt: Date; deletedAt: Date | null }>(
        `SELECT "displayName","location","createdAt","deletedAt" FROM "worship_records" WHERE "id"=$1`, e.wrid))[0];
      if (wr) console.log(`永久牌位(WorshipRecord)：${wr.displayName}｜安奉地=${wr.location ?? "（無）"}｜建立=${new Date(wr.createdAt).toISOString()}${wr.deletedAt ? "（已封存）" : ""}`);
    }

    // RecordVersion（建立/異動足跡）
    const rv = await q<{ action: string; operatorName: string | null; changeNote: string | null; createdAt: Date }>(
      `SELECT "action"::text AS action, "operatorName", "changeNote", "createdAt"
       FROM "record_versions" WHERE "entityType"='UniversalSalvationEntry' AND "entityId"=$1 ORDER BY "createdAt" ASC`, e.eid);
    console.log(`RecordVersion（${rv.length} 筆）：`);
    for (const v of rv) console.log(`   - ${new Date(v.createdAt).toISOString()}｜${v.action}｜操作人=${v.operatorName ?? "?"}｜${(v.changeNote ?? "").slice(0, 140)}`);

    // 對應匯入草稿列（判 CREATE/UPDATE/SKIP 與配對結果）
    const rows = await q<{ rowNumber: number; matchingStatus: string; resolutionAction: string | null; existingMatchStatus: string | null; confirmationStatus: string; normalizedData: unknown; confirmedRecordId: string | null; existingRecordId: string | null }>(
      `SELECT "rowNumber","matchingStatus","resolutionAction","existingMatchStatus","confirmationStatus","normalizedData","confirmedRecordId","existingRecordId"
       FROM "purification_import_rows" WHERE "confirmedRecordId"=$1 OR "existingRecordId"=$2`, e.rrid, e.eid);
    console.log(`對應匯入草稿列（${rows.length} 筆）：`);
    for (const rr of rows) {
      const nd = (rr.normalizedData ?? {}) as Record<string, unknown>;
      const path = rr.resolutionAction === "SKIP" || rr.existingMatchStatus === "EXISTS" ? "SKIP(已存在)" : rr.resolutionAction === "UPDATE" ? "UPDATE" : "CREATE(推定)";
      console.log(`   - 行#${rr.rowNumber}｜matching=${rr.matchingStatus}｜resolution=${rr.resolutionAction ?? "—"}｜existing=${rr.existingMatchStatus ?? "—"}｜confirmation=${rr.confirmationStatus}｜路徑=${path}｜Excel地址=${String(nd.tabletAddress ?? "（無）")}｜Excel家戶編號=${String(nd.householdCode ?? "（無）")}`);
    }
    if (rows.length === 0) console.log(`   （無對應匯入列 → 此筆非本次 Excel 匯入建立，疑為 HOUSEHOLD_PAGE 手動或沿用去年）`);
    console.log("");
  }

  // 跡證彙整（供判根因，不下結論）
  if (entries.length >= 2) {
    console.log(`──────── 跡證彙整（兩筆比較）────────`);
    const [a, b] = entries;
    console.log(`地址是否不同：${(a.addr ?? "") !== (b.addr ?? "") ? `是（「${a.addr ?? "無"}」 vs 「${b.addr ?? "無"}」）` : "否（相同）"}`);
    console.log(`來源是否不同：${(a.regsrc ?? "") !== (b.regsrc ?? "") ? `是（${a.regsrc ?? "null"} vs ${b.regsrc ?? "null"}）` : `否（皆 ${a.regsrc ?? "null"}）`}`);
    console.log(`是否其一有永久牌位連結：${a.wrid || b.wrid ? `是（第${a.wrid ? 1 : 2}筆連 WorshipRecord）` : "否（皆無）"}`);
    console.log(`建立時間先後：第1筆 ${new Date(a.ecreated).toISOString()}，第2筆 ${new Date(b.ecreated).toISOString()}`);
    console.log(`\n※ 根因請依上列跡證判讀（來源／匯入路徑／配對結果／地址／永久牌位）；本腳本只呈現事實，不臆測。`);
  }
  console.log(`\n（唯讀追查結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
