import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";

/**
 * V36.14 從「永久牌位名單(WorshipRecord＝祭祀資料)」回填普渡牌位(entry)的安奉地。
 *
 * 用途：永久名單清乾淨（安奉地正確）後，把普渡牌位的 tabletAddress 一次對齊成「同家戶＋同類別
 * ＋同核心名」那張永久牌位（祭祀資料）的地址。修正「匯入時抓成戶籍地、或拆戶後地址沒跟著更新」
 * 的既有資料。只處理祖先／乙位正魂（有永久牌位者）；冤親／無緣不動（另有工具）。
 * 不動收款、不動名稱、不重匯。
 *
 * ── 定案規則（Stella）：牌位地址一律「以祭祀資料為準」。 ──────────────
 *
 * commit=false（預設）＝預覽；commit=true ＝實際更新 entry.tabletAddress。
 * 除了原本的「年度整批」入口，另提供「單一報名(ritualRecord)」就地預覽＋逐筆套用，
 * 讓宮裡改完一戶資料後可以馬上在報名頁重新對齊地址（見報名頁「重新對齊地址」）。
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

/** 供比對用的牌位資料（祖先／乙位正魂）。 */
type EntryForAddr = {
  id: string; category: string; displayName: string; tabletAddress: string | null; householdId: string;
};

/**
 * 共用核心：給一批牌位，查其家戶的祭祀資料(WorshipRecord.location)，算出「應對齊的地址」差異。
 * 只回「祭祀資料有地址、且與現況不同」的牌位；找不到對應祭祀資料者計入 noWorshipMatch。
 */
async function computeEntryAddressChanges(
  entries: EntryForAddr[]
): Promise<{ changes: EntryAddrChange[]; noWorshipMatch: number }> {
  const householdIds = [...new Set(entries.map((e) => e.householdId).filter((x): x is string => !!x))];
  const wrs = householdIds.length
    ? await prisma.worshipRecord.findMany({
        where: { householdId: { in: householdIds }, type: { in: ["ANCESTOR_LINE", "INDIVIDUAL"] }, deletedAt: null },
        select: { householdId: true, type: true, displayName: true, location: true },
      })
    : [];
  // 索引：家戶|type|核心名 → location（祭祀資料的安奉地）。
  const wrByKey = new Map<string, string | null>();
  for (const w of wrs) {
    const cat = w.type === "ANCESTOR_LINE" ? "ANCESTOR_LINE" : "INDIVIDUAL_SOUL";
    const key = `${w.householdId}|${w.type}|${normalizeTabletText(normalizeRitualNameForStore(cat, w.displayName))}`;
    if (!wrByKey.has(key)) wrByKey.set(key, w.location);
  }

  const changes: EntryAddrChange[] = [];
  let noMatch = 0;
  for (const e of entries) {
    const type = CAT_TO_TYPE[e.category];
    if (!type) continue;
    const key = `${e.householdId}|${type}|${normalizeTabletText(normalizeRitualNameForStore(e.category, e.displayName))}`;
    const loc = wrByKey.get(key);
    if (!loc || !norm(loc)) { noMatch++; continue; }
    if (norm(loc) === norm(e.tabletAddress)) continue; // 已一致
    changes.push({ entryId: e.id, householdId: e.householdId, category: e.category, displayName: e.displayName, oldAddress: e.tabletAddress, newAddress: loc.trim() });
  }
  changes.sort((a, b) => (a.householdId < b.householdId ? -1 : 1));
  return { changes, noWorshipMatch: noMatch };
}

export async function backfillEntryAddress(year: number, opts: { commit: boolean }): Promise<BackfillEntryAddressReport> {
  const commit = !!opts.commit;
  const rows = await prisma.universalSalvationEntry.findMany({
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
  const entries: EntryForAddr[] = rows
    .map((e) => ({
      id: e.id, category: e.category, displayName: e.displayName, tabletAddress: e.tabletAddress,
      householdId: e.universalSalvation?.ritualRecord?.householdId ?? "",
    }))
    .filter((e) => e.householdId);

  const { changes, noWorshipMatch } = await computeEntryAddressChanges(entries);

  const base: BackfillEntryAddressReport = { ok: true, commit, year, totalEntries: rows.length, changes, noWorshipMatch };
  if (!commit || changes.length === 0) return base;

  await prisma.$transaction(changes.map((c) => prisma.universalSalvationEntry.update({ where: { id: c.entryId }, data: { tabletAddress: c.newAddress } })));
  return base;
}

// ────────────────────────────────────────────────────────────────
// 單一報名(ritualRecord)就地版：報名頁「重新對齊地址」用。
// 預覽只讀；套用只改「使用者勾選的」牌位，不整批硬套（保護手動填對的地址）。
// ────────────────────────────────────────────────────────────────

/** 取某筆報名底下的祖先／乙位正魂牌位（供地址對齊）。 */
async function entriesForRecord(ritualRecordId: string): Promise<EntryForAddr[]> {
  const rows = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      category: { in: ["ANCESTOR_LINE", "INDIVIDUAL_SOUL"] },
      universalSalvation: { ritualRecordId },
    },
    select: {
      id: true, category: true, displayName: true, tabletAddress: true,
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
  });
  return rows
    .map((e) => ({
      id: e.id, category: e.category, displayName: e.displayName, tabletAddress: e.tabletAddress,
      householdId: e.universalSalvation?.ritualRecord?.householdId ?? "",
    }))
    .filter((e) => e.householdId);
}

/** 預覽：這筆報名有哪些牌位地址跟祭祀資料不一致（純讀取）。 */
export async function previewRecordEntryAddressRealign(
  ritualRecordId: string
): Promise<{ ok: true; changes: EntryAddrChange[]; noWorshipMatch: number } | { ok: false; status: number; error: string }> {
  const record = await prisma.ritualRecord.findUnique({ where: { id: ritualRecordId }, select: { id: true, deletedAt: true } });
  if (!record || record.deletedAt) return { ok: false, status: 404, error: "找不到這筆活動報名" };
  const { changes, noWorshipMatch } = await computeEntryAddressChanges(await entriesForRecord(ritualRecordId));
  return { ok: true, changes, noWorshipMatch };
}

/**
 * 套用：只更新使用者勾選的牌位地址（entryIds）。再算一次現況避免時間差覆蓋，
 * 且只套「現在仍與祭祀資料不一致、且屬於這筆報名」的牌位。回實際更新筆數。
 */
export async function applyRecordEntryAddressRealign(
  ritualRecordId: string,
  entryIds: string[]
): Promise<{ ok: true; updated: number } | { ok: false; status: number; error: string }> {
  const record = await prisma.ritualRecord.findUnique({ where: { id: ritualRecordId }, select: { id: true, deletedAt: true } });
  if (!record || record.deletedAt) return { ok: false, status: 404, error: "找不到這筆活動報名" };
  const wanted = new Set(entryIds);
  if (wanted.size === 0) return { ok: true, updated: 0 };

  const { changes } = await computeEntryAddressChanges(await entriesForRecord(ritualRecordId));
  const toApply = changes.filter((c) => wanted.has(c.entryId));
  if (toApply.length === 0) return { ok: true, updated: 0 };

  await prisma.$transaction(toApply.map((c) => prisma.universalSalvationEntry.update({ where: { id: c.entryId }, data: { tabletAddress: c.newAddress } })));
  return { ok: true, updated: toApply.length };
}
