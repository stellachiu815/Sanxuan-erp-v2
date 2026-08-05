/**
 * V36.4B：115 普渡「多出 2 筆有效牌位」＋「額外寶袋漏建」逐筆追查（唯讀，只 SELECT）。
 *
 *   npx tsx scripts/auditEntryPocket115.ts
 */
import { prisma } from "../src/lib/prisma";
const YEAR = 115;
async function q<T>(sql: string, ...p: unknown[]): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql, ...p); }
const CAT: Record<string, string> = { ANCESTOR_LINE: "歷代祖先", INDIVIDUAL_SOUL: "乙位正魂", DEBT_CREDITOR: "累世冤親債主", UNBORN_CHILD: "無緣子女" };

async function main() {
  console.log(`=== V36.4B 115 牌位＋額外寶袋追查（唯讀）===\n`);

  // ── A) 全部有效（未封存）牌位 ──
  const entries = await q<{
    eid: string; category: string; displayName: string; createdAt: Date; rrid: string; rrstatus: string;
    regsource: string | null; hhid: string; hhname: string | null; ristatus: string | null; memberName: string | null;
    yangshang: string[] | null;
  }>(
    `SELECT e."id" AS eid, e."category"::text AS category, e."displayName", e."createdAt",
            rr."id" AS rrid, rr."status"::text AS rrstatus, rr."registrationSource" AS regsource,
            rr."householdId" AS hhid, h."name" AS hhname,
            rri."status"::text AS ristatus, m."name" AS "memberName", e."yangshangNames" AS yangshang
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" usd ON usd."id" = e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id" = usd."ritualRecordId"
     LEFT JOIN "households" h ON h."id" = rr."householdId"
     LEFT JOIN "ritual_registration_items" rri ON rri."universalSalvationEntryId" = e."id"
     LEFT JOIN "members" m ON m."id" = rri."memberId"
     WHERE e."deletedAt" IS NULL AND rr."deletedAt" IS NULL
       AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'
     ORDER BY e."category", h."name", e."createdAt"`);

  // 匯入建立/觸及的 ritualRecordId（confirmedRecordId）。
  const impRows = await q<{ rrid: string }>(
    `SELECT DISTINCT r."confirmedRecordId" AS rrid
     FROM "purification_import_rows" r JOIN "purification_import_batches" b ON b."id"=r."batchId"
     WHERE b."year"=${YEAR} AND r."confirmationStatus"='CONFIRMED' AND r."confirmedRecordId" IS NOT NULL`);
  const importRecordIds = new Set(impRows.map((r) => r.rrid));

  console.log(`── A) 有效牌位 ${entries.length} 筆 ──`);
  console.log(`entry.id | 類別 | 顯示名稱 | 家戶 | 報名人/陽上 | 來源 | 匯入觸及 | RRI狀態 | RR狀態 | 建立時間`);
  const catCount: Record<string, number> = {};
  for (const e of entries) {
    catCount[e.category] = (catCount[e.category] ?? 0) + 1;
    const fromImport = importRecordIds.has(e.rrid);
    const who = e.memberName ?? (e.yangshang && e.yangshang.length ? e.yangshang.join("、") : "—");
    console.log(`${e.eid} | ${CAT[e.category] ?? e.category} | ${e.displayName} | ${e.hhid}｜${e.hhname ?? "?"} | ${who} | ${e.regsource ?? "—"} | ${fromImport ? "是" : "否(疑手動/舊)"} | ${e.ristatus ?? "無RRI"} | ${e.rrstatus} | ${new Date(e.createdAt).toISOString()}`);
  }
  console.log(`\n各類別有效牌位數（對照 Excel 祖先34/乙位13/冤親2）：` + Object.entries(catCount).map(([k, v]) => `${CAT[k] ?? k} ${v}`).join("、"));
  const notFromImport = entries.filter((e) => !importRecordIds.has(e.rrid));
  console.log(`\n── 疑「只存在系統、非本次 Excel 匯入」候選（其 RitualRecord 未被任何匯入列確認）：${notFromImport.length} 筆 ──`);
  for (const e of notFromImport) console.log(`  ${CAT[e.category] ?? e.category}｜${e.displayName}｜家戶 ${e.hhid}｜${e.hhname ?? "?"}｜來源 ${e.regsource ?? "—"}｜RR=${e.rrstatus}｜建立 ${new Date(e.createdAt).toISOString()}`);

  // ── B) 額外寶袋（extraPocketCount>0）追查 ──
  console.log(`\n── B) Excel 額外寶袋列追查 ──`);
  const rows = await q<{ batchId: string; rowNumber: number; normalizedData: unknown; editedData: unknown; confirmationStatus: string; resolutionAction: string | null; existingMatchStatus: string | null; matchingStatus: string; confirmedRecordId: string | null }>(
    `SELECT r."batchId", r."rowNumber", r."normalizedData", r."editedData", r."confirmationStatus", r."resolutionAction", r."existingMatchStatus", r."matchingStatus", r."confirmedRecordId"
     FROM "purification_import_rows" r JOIN "purification_import_batches" b ON b."id"=r."batchId"
     WHERE b."year"=${YEAR}`);
  const extraRows = rows.filter((r) => {
    const nd = ((r.editedData ?? r.normalizedData) ?? {}) as Record<string, unknown>;
    return Number(nd.extraPocketCount ?? 0) > 0;
  });
  console.log(`偵測到 Excel 額外寶袋>0 的匯入列：${extraRows.length} 筆`);
  for (const r of extraRows) {
    const nd = ((r.editedData ?? r.normalizedData) ?? {}) as Record<string, unknown>;
    console.log(`  行#${r.rowNumber}｜牌位 ${String(nd.tabletName ?? nd.devoteeName ?? "?")}｜類別 ${String(nd.tabletCategory ?? "?")}｜額外寶袋數 ${String(nd.extraPocketCount)}｜matching=${r.matchingStatus}｜confirmation=${r.confirmationStatus}｜resolution=${r.resolutionAction ?? "—"}｜existing=${r.existingMatchStatus ?? "—"}｜confirmedRecordId=${r.confirmedRecordId ?? "—"}`);
    // 對應家戶是否真的建了 US_POCKET_EXTRA RRI 與 isExtra=true 列印物件。
    if (r.confirmedRecordId) {
      const extraRri = await q<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "ritual_registration_items" rri JOIN "registration_item_types" t ON t."id"=rri."registrationItemTypeId"
         WHERE rri."ritualRecordId"='${r.confirmedRecordId.replace(/'/g, "''")}' AND t."key"='US_POCKET_EXTRA'`);
      const extraApi = await q<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM "additional_print_items" WHERE "ritualRecordId"='${r.confirmedRecordId.replace(/'/g, "''")}' AND "isExtra"=true AND "deletedAt" IS NULL`);
      console.log(`     → 該 record 的 US_POCKET_EXTRA RRI：${extraRri[0]?.n ?? 0}｜isExtra=true 列印物件：${extraApi[0]?.n ?? 0}`);
      console.log(`     → 研判：${(r.resolutionAction === "SKIP" || r.existingMatchStatus === "EXISTS") ? "此列為『已存在→略過(SKIP)』，而額外寶袋僅在 CREATE 路徑建立 → 額外寶袋未建（根因）。" : r.resolutionAction === "UPDATE" ? "此列為『更新(UPDATE)』，UPDATE 路徑不建額外寶袋 → 未建。" : "此列為 CREATE；若上方 isExtra 列印物件=0，則為 newEntry 比對失敗或數量解析問題。"}`);
    }
  }

  // 全年度 isExtra=true 寶袋實際數（對照 UI 額外寶袋=0）。
  const totalExtra = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM "additional_print_items" api JOIN "ritual_records" rr ON rr."id"=api."ritualRecordId"
     WHERE api."itemType"::text='POCKET' AND api."isExtra"=true AND api."deletedAt" IS NULL
       AND rr."year"=${YEAR} AND rr."activityType"::text='UNIVERSAL_SALVATION'`);
  console.log(`\n全 ${YEAR} 年度 isExtra=true 額外寶袋列印物件實際數：${totalExtra[0]?.n ?? 0}`);
  console.log(`\n（唯讀追查結束，未修改任何資料。）`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
