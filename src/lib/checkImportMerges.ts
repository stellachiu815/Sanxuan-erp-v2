import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.14 匯入合併檢查：找出「同家戶＋同類別＋同核心名」被匯入合成一張牌位的多列
 * （這是『同姓同戶不重複』規則造成 49 列→48 張的原因）。純唯讀，供人工確認該不該合。
 */

const SUFFIX_CAT: Record<string, string> = { 歷代祖先: "ANCESTOR_LINE", 乙位正魂: "INDIVIDUAL_SOUL", 累世冤親債主: "DEBT_CREDITOR", 無緣子女: "UNBORN_CHILD" };

export type MergeGroup = {
  householdId: string | null; category: string; coreName: string; rowCount: number;
  rows: { rowNumber: number; tabletName: string | null; address: string | null; yangshang: string | null }[];
};
export type ImportMergeReport = { ok: boolean; year: number; importRows: number; distinctTablets: number; mergedGroups: number; groups: MergeGroup[] };

async function q<T>(sql: string): Promise<T[]> { return prisma.$queryRawUnsafe<T[]>(sql); }

export async function checkImportMerges(year: number): Promise<ImportMergeReport> {
  const rows = await q<{ rn: number; hh: string | null; cat: string | null; tname: string | null; taddr: string | null; yang: string | null }>(
    `SELECT r."rowNumber" rn, r."matchedHouseholdId" hh,
            COALESCE(r."editedData"->>'tabletCategory', r."normalizedData"->>'tabletCategory') cat,
            COALESCE(r."editedData"->>'tabletName', r."normalizedData"->>'tabletName') tname,
            COALESCE(r."editedData"->>'tabletAddress', r."normalizedData"->>'tabletAddress') taddr,
            COALESCE(r."editedData"->>'devoteeName', r."normalizedData"->>'devoteeName') yang
     FROM "purification_import_rows" r
     JOIN "purification_import_batches" b ON b."id"=r."batchId"
     WHERE b."year"=${year}`);

  const groupMap = new Map<string, MergeGroup>();
  for (const r of rows) {
    const cat = r.cat && SUFFIX_CAT[r.cat] ? SUFFIX_CAT[r.cat] : (r.cat ?? "ANCESTOR_LINE");
    if (!["ANCESTOR_LINE", "INDIVIDUAL_SOUL"].includes(cat)) continue; // 只查會合併的祖先/正魂
    const core = normalizeTabletText(normalizeRitualNameForStore(cat as "ANCESTOR_LINE" | "INDIVIDUAL_SOUL", r.tname ?? ""));
    if (!core) continue;
    const key = `${r.hh ?? "?"}|${cat}|${core}`;
    const g = groupMap.get(key) ?? { householdId: r.hh, category: cat, coreName: core, rowCount: 0, rows: [] };
    g.rowCount++;
    g.rows.push({ rowNumber: r.rn, tabletName: r.tname, address: r.taddr, yangshang: r.yang });
    groupMap.set(key, g);
  }

  const merged = [...groupMap.values()].filter((g) => g.rowCount > 1).sort((a, b) => (a.householdId ?? "") < (b.householdId ?? "") ? -1 : 1);
  return { ok: true, year, importRows: rows.length, distinctTablets: groupMap.size, mergedGroups: merged.length, groups: merged };
}
