/**
 * V33 §9 累世冤親債主重複——唯讀診斷報告（不寫入任何正式資料）。
 *
 *   # 全年度
 *   npx tsx scripts/yuanqinDuplicateDiagnose.ts
 *   # 指定民國年
 *   YEAR=115 npx tsx scripts/yuanqinDuplicateDiagnose.ts
 *   # 另存 CSV
 *   OUT=scripts/data/yuanqin-dup-115.csv YEAR=115 npx tsx scripts/yuanqinDuplicateDiagnose.ts
 *
 * 逐筆列出 household / member / ritualRecordId / registrationItemId / entryId /
 * additionalPrintItemId / itemType / isExtra / status / deletedAt / workOrder / 重複分類 / 建議處理方式。
 * 只讀取、只分類；不刪除、不合併、不覆寫。修復請改用 printObjectDedupeRepair.ts（先 dry-run）。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../src/lib/prisma";
import {
  classifyYuanqin,
  summarizeClassifications,
  type YuanqinEntryRow,
  type YuanqinPrintObjectRow,
} from "../src/lib/yuanqinDuplicateAnalysis";

type EntryQ = {
  entryId: string | null; registrationItemId: string; ritualRecordId: string; householdId: string;
  memberId: string | null; displayName: string | null; tabletAddress: string | null; memberAddress: string | null;
  workOrder: number | null; itemStatus: string; itemDeletedAt: Date | null; entryDeletedAt: Date | null;
};
type PoQ = {
  additionalPrintItemId: string; entryId: string; itemType: string; isExtra: boolean; status: string;
  deletedAt: Date | null; printCount: number; createdAt: Date | null;
};

async function main() {
  const yearEnv = process.env.YEAR ? Number(process.env.YEAR) : null;
  const out = process.env.OUT ?? null;

  const entriesQ = await prisma.$queryRawUnsafe<EntryQ[]>(`
    SELECT rri."universalSalvationEntryId" AS "entryId", rri."id" AS "registrationItemId",
           rr."id" AS "ritualRecordId", rr."householdId", rri."memberId",
           e."displayName", e."tabletAddress", m."address" AS "memberAddress",
           rri."workOrder", rri."status" AS "itemStatus", rri."deletedAt" AS "itemDeletedAt", e."deletedAt" AS "entryDeletedAt"
    FROM "ritual_registration_items" rri
    JOIN "registration_item_types" rit ON rit."id" = rri."registrationItemTypeId" AND rit."key" = 'US_YUANQIN'
    JOIN "ritual_records" rr ON rr."id" = rri."ritualRecordId"
    LEFT JOIN "universal_salvation_entries" e ON e."id" = rri."universalSalvationEntryId"
    LEFT JOIN "members" m ON m."id" = rri."memberId"
    WHERE rr."activityType" = 'UNIVERSAL_SALVATION'
      ${yearEnv != null ? `AND rr."year" = ${yearEnv}` : ""}
  `);

  const entryIds = entriesQ.map((e) => e.entryId).filter((x): x is string => !!x);
  const poQ = entryIds.length
    ? await prisma.$queryRawUnsafe<PoQ[]>(`
        SELECT "id" AS "additionalPrintItemId", "sourceEntryId" AS "entryId", "itemType", "isExtra",
               "status", "deletedAt", "printCount", "createdAt"
        FROM "additional_print_items"
        WHERE "sourceEntryId" IN (${entryIds.map((id) => `'${id.replace(/'/g, "''")}'`).join(",")})
      `)
    : [];

  const entryRows: YuanqinEntryRow[] = entriesQ
    .filter((e) => e.entryId)
    .map((e) => ({
      entryId: e.entryId!, ritualRecordId: e.ritualRecordId, householdId: e.householdId, memberId: e.memberId,
      displayName: e.displayName ?? "", tabletAddress: e.tabletAddress, memberAddress: e.memberAddress,
      registrationItemId: e.registrationItemId, workOrder: e.workOrder,
      status: e.itemStatus, deletedAt: e.itemDeletedAt ? e.itemDeletedAt.toISOString() : (e.entryDeletedAt ? e.entryDeletedAt.toISOString() : null),
    }));
  const poRows: YuanqinPrintObjectRow[] = poQ.map((p) => ({
    additionalPrintItemId: p.additionalPrintItemId, entryId: p.entryId, itemType: p.itemType, isExtra: p.isExtra,
    status: p.status, deletedAt: p.deletedAt ? p.deletedAt.toISOString() : null, printCount: p.printCount ?? 0,
    createdAt: p.createdAt ? p.createdAt.toISOString() : null,
  }));

  const classified = classifyYuanqin(entryRows, poRows);
  const summary = summarizeClassifications(classified);
  const poByEntry = new Map<string, PoQ[]>();
  for (const p of poQ) (poByEntry.get(p.entryId) ?? poByEntry.set(p.entryId, []).get(p.entryId)!).push(p);

  console.log("=== V33 §9 累世冤親債主重複 唯讀診斷 ===");
  console.log(`年度：${yearEnv ?? "全部"}｜有效/歷史 Entry 共 ${entryRows.length} 筆｜列印物件 ${poRows.length} 筆`);
  console.log("分類統計：", summary);
  console.log("");

  const lines: string[] = [
    "householdId,memberId,ritualRecordId,registrationItemId,entryId,additionalPrintItemId,itemType,isExtra,status,deletedAt,workOrder,classes,suggestion",
  ];
  for (const c of classified) {
    const pos = poByEntry.get(c.entryId) ?? [];
    const posText = pos.length ? pos.map((p) => `${p.additionalPrintItemId}(${p.itemType}${p.isExtra ? ",extra" : ""},pc${p.printCount}${p.deletedAt ? ",del" : ""})`).join(" ") : "-";
    console.log(
      `H${c.householdId} m${c.memberId ?? "-"} rr${c.ritualRecordId} entry${c.entryId} No.${c.workOrder ?? "-"} [${c.classes.join(",")}] ${c.suggestion}\n   物件: ${posText}`
    );
    if (out) {
      for (const p of pos.length ? pos : [null]) {
        lines.push([
          c.householdId, c.memberId ?? "", c.ritualRecordId, "", c.entryId,
          p?.additionalPrintItemId ?? "", p?.itemType ?? "", String(p?.isExtra ?? ""), p?.status ?? "",
          p?.deletedAt ? "1" : "", String(c.workOrder ?? ""), c.classes.join("|"), c.suggestion,
        ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
      }
    }
  }
  if (out) {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, lines.join("\n"), "utf-8");
    console.log(`\nCSV 已輸出：${out}`);
  }
  console.log("\n此為唯讀診斷，未寫入任何正式資料。修復請先跑 printObjectDedupeRepair.ts（dry-run）。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
