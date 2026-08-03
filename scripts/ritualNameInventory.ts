/**
 * V33.1 歷代祖先／乙位正魂 名稱「唯讀盤點」（不寫入任何正式資料）。
 *
 *   npx tsx scripts/ritualNameInventory.ts
 *   OUT=scripts/data/ritual-name-inventory.csv npx tsx scripts/ritualNameInventory.ts
 *
 * 逐筆列出 householdCode / memberId / entryId / registrationItemId / 正式 type / 原始儲存值 /
 * 正規化核心 / 預期完整顯示 / 分類（A~E）/ 是否可自動修正 / 建議處理方式。
 * 涵蓋：家戶永久祭祀資料（WorshipRecord）＋普渡報名（UniversalSalvationEntry）。只讀不寫。
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { prisma } from "../src/lib/prisma";
import { classifyRitualName, categoryFromWorshipType, type RitualNameCategory } from "../src/lib/ritualDisplayName";

type Row = {
  scope: "WorshipRecord" | "UniversalSalvationEntry";
  householdCode: string; memberId: string; entryId: string; registrationItemId: string;
  type: string; raw: string;
};

async function main() {
  const out = process.env.OUT ?? null;

  const worship = await prisma.$queryRawUnsafe<{ hh: string; mid: string | null; id: string; type: string; name: string | null }[]>(
    `SELECT "householdId" AS hh, "memberId" AS mid, "id", "type", "displayName" AS name
     FROM "worship_records" WHERE "deletedAt" IS NULL AND "type" IN ('ANCESTOR_LINE','INDIVIDUAL')`
  );
  const entries = await prisma.$queryRawUnsafe<{ hh: string; eid: string; rid: string | null; cat: string; name: string | null }[]>(
    `SELECT rr."householdId" AS hh, e."id" AS eid, rri."id" AS rid, e."category" AS cat, e."displayName" AS name
     FROM "universal_salvation_entries" e
     JOIN "universal_salvation_details" d ON d."id" = e."universalSalvationId"
     JOIN "ritual_records" rr ON rr."id" = d."ritualRecordId"
     LEFT JOIN "ritual_registration_items" rri ON rri."universalSalvationEntryId" = e."id"
     WHERE e."deletedAt" IS NULL AND e."category" IN ('ANCESTOR_LINE','INDIVIDUAL_SOUL')`
  ).catch(() => [] as { hh: string; eid: string; rid: string | null; cat: string; name: string | null }[]);

  const rows: Row[] = [
    ...worship.map((w) => ({ scope: "WorshipRecord" as const, householdCode: w.hh, memberId: w.mid ?? "", entryId: w.id, registrationItemId: "", type: w.type, raw: w.name ?? "" })),
    ...entries.map((e) => ({ scope: "UniversalSalvationEntry" as const, householdCode: e.hh, memberId: "", entryId: e.eid, registrationItemId: e.rid ?? "", type: e.cat, raw: e.name ?? "" })),
  ];

  const summary: Record<string, number> = {};
  const lines: string[] = ["scope,householdCode,memberId,entryId,registrationItemId,type,raw,core,expectedDisplay,classification,autoFixable,suggestion"];
  for (const r of rows) {
    const cat: RitualNameCategory | null = r.scope === "WorshipRecord" ? categoryFromWorshipType(r.type) : (r.type as RitualNameCategory);
    const c = classifyRitualName(cat ?? "", r.raw);
    summary[c.classification] = (summary[c.classification] ?? 0) + 1;
    if (out) lines.push([r.scope, r.householdCode, r.memberId, r.entryId, r.registrationItemId, r.type, r.raw, c.core, c.expectedDisplay, c.classification, String(c.autoFixable), c.suggestion].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  }

  console.log("=== V33.1 歷代祖先／乙位正魂 名稱唯讀盤點 ===");
  console.log(`資料筆數：WorshipRecord ${worship.length}｜UniversalSalvationEntry ${entries.length}｜合計 ${rows.length}`);
  console.log("分類統計：", summary);
  console.log("  A_CORE_OK 核心正確；B_HAS_SUFFIX 已含後綴；C_DUP_SUFFIX 重複後綴；D_TYPE_TEXT_MISMATCH 疑類型/文字不一致(含府)；E_UNRESOLVABLE 無法安全判斷");
  console.log("修正原則：A/B 顯示層已正確（不改資料）；C 可安全正規化；D/E 列 NEEDS_REVIEW，未經授權不自動修改。");
  if (out) { mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, lines.join("\n"), "utf-8"); console.log(`\nCSV 已輸出：${out}`); }
  console.log("\n此為唯讀盤點，未寫入任何正式資料。");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
