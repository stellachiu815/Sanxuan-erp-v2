import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.14 從「永久牌位名單(WorshipRecord)」回填普渡牌位(entry)的安奉地。
 *
 * 用途：永久名單清乾淨（安奉地正確）後，把該年度普渡牌位的 tabletAddress 一次對齊成「同家戶＋同類別
 * ＋同核心名」那張永久牌位的地址。修正「匯入時抓成戶籍地（新北）而非安奉地（雲林）」的既有資料。
 * 只處理祖先／乙位正魂（有永久牌位者）；冤親／無緣不動。不動收款、不動名稱、不重匯。
 *
 * commit=false（預設）＝預覽；commit=true ＝實際更新 entry.tabletAddress。
 */

const CAT_TO_TYPE: Record<string, "ANCESTOR_LINE" | "INDIVIDUAL"> = {
  ANCESTOR_LINE: "ANCESTOR_LINE",
  INDIVIDUAL_SOUL: "INDIVIDUAL",
};

export type EntryAddrChange = {
  entryId: string; householdId: string; category: string; displayName: string;
  oldAddress: string | null; newAddress: string;
};
export type BackfillEntryAddressReport = {
  ok: boolean; commit: boolean; year: number;
  totalEntries: number; changes: EntryAddrChange[]; noWorshipMatch: number; error?: string;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/\s/g, "").trim();

export async function backfillEntryAddress(year: number, opts: { commit: boolean }): Promise<BackfillEntryAddressReport> {
  const commit = !!opts.commit;
  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      category: { in: ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"] },
      universalSalvation: { ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    },
    select: {
      id: true, category: true, displayName: true, tabletAddress: true,
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
  });

  const householdIds = [...new Set(entries.map((e) => e.universalSalvation?.ritualRecord?.householdId).filter((x): x is string => !!x))];
  const wrs = householdIds.length
    ? await prisma.worshipRecord.findMany({
        where: { householdId: { in: householdIds }, type: { in: ["ANCESTOR_LINE", "INDIVIDUAL"] }, deletedAt: null },
        select: { householdId: true, type: true, displayName: true, location: true },
      })
    : [];
  // 索引：家戶|type|核心名 → location。
  const wrByKey = new Map<string, string | null>();
  for (const w of wrs) {
    const cat = w.type === "ANCESTOR_LINE" ? "ANCESTOR_LINE" : "INDIVIDUAL_SOUL";
    const key = `${w.householdId}|${w.type}|${normalizeTabletText(normalizeRitualNameForStore(cat, w.displayName))}`;
    if (!wrByKey.has(key)) wrByKey.set(key, w.location);
  }

  const changes: EntryAddrChange[] = [];
  let noMatch = 0;
  for (const e of entries) {
    const hh = e.universalSalvation?.ritualRecord?.householdId;
    if (!hh) continue;
    const type = CAT_TO_TYPE[e.category];
    const key = `${hh}|${type}|${normalizeTabletText(normalizeRitualNameForStore(e.category, e.displayName))}`;
    const loc = wrByKey.get(key);
    if (!loc || !norm(loc)) { noMatch++; continue; }
    if (norm(loc) === norm(e.tabletAddress)) continue; // 已一致
    changes.push({ entryId: e.id, householdId: hh, category: e.category, displayName: e.displayName, oldAddress: e.tabletAddress, newAddress: loc.trim() });
  }
  changes.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));

  const base: BackfillEntryAddressReport = { ok: true, commit, year, totalEntries: entries.length, changes, noWorshipMatch: noMatch };
  if (!commit || changes.length === 0) return base;

  await prisma.$transaction(changes.map((c) => prisma.universalSalvationEntry.update({ where: { id: c.entryId }, data: { tabletAddress: c.newAddress } })));
  return base;
}
