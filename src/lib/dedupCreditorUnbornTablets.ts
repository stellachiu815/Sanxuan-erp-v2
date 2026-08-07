import { prisma } from "@/lib/prisma";
import { normalizeTabletText } from "@/lib/tabletIdentity";
import { normalizeRitualNameForStore } from "@/lib/ritualDisplayName";
import { removeRegisteredItem } from "@/lib/registrationItemRegistration";

/**
 * V38 清理「冤親／無緣子女／地基主」的**重複牌位**。
 *
 * 背景：手動重報冤親／無緣時，直接新增牌位那條路徑不做冪等比對，會出現同一戶、同一位
 * 陽上人、同一張牌位被建了兩筆（例：許佩瑜冤親 ×2、馮是嘉無緣 ×2）。
 *
 * 規則：同一報名（RitualRecord）內、同 category＋同主文＋同陽上人＋同地址 視為重複。
 *   保留一張（**有地址者優先**，其次最早建立），其餘用既有安全流程 removeRegisteredItem
 *   取消（會一併軟刪牌位、扣掉重複計價；已收款／已列印者擋下不動、如實回報）。
 * 只動冤親／無緣／地基主；不碰祖先／乙位正魂。commit=false 預覽、true 才執行。
 */

const norm = (s: string | null | undefined) => normalizeTabletText((s ?? "").trim());

function yangKey(names: string[] | null | undefined, single: string | null | undefined): string {
  const arr = Array.isArray(names) && names.length > 0 ? names : single ? [single] : [];
  return arr.map((n) => norm(n)).filter(Boolean).sort().join("+");
}

export type DedupEntryRow = {
  entryId: string;
  registrationItemId: string | null;
  displayName: string;
  category: string;
  yangshang: string;
  address: string | null;
  createdAt: string;
  keep: boolean;
  removeBlocked?: string | null;
};
export type DedupGroup = {
  householdId: string;
  category: string;
  coreName: string;
  yangshang: string;
  rows: DedupEntryRow[];
};
export type DedupCreditorUnbornReport = {
  ok: boolean;
  commit: boolean;
  year: number;
  totalEntries: number;
  duplicateGroups: number;
  groups: DedupGroup[];
  cancelled?: number;
  blocked?: { entryId: string; reason: string }[];
  error?: string;
};

export async function dedupCreditorUnbornTablets(
  year: number,
  opts: { commit: boolean; operatorName?: string | null }
): Promise<DedupCreditorUnbornReport> {
  const commit = !!opts.commit;

  const entries = await prisma.universalSalvationEntry.findMany({
    where: {
      deletedAt: null,
      category: { in: ["DEBT_CREDITOR", "UNBORN_CHILD"] },
      universalSalvation: { ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null } },
    },
    select: {
      id: true,
      category: true,
      displayName: true,
      tabletAddress: true,
      yangshangName: true,
      yangshangNames: true,
      createdAt: true,
      registrationItem: { select: { id: true } },
      universalSalvation: { select: { ritualRecord: { select: { householdId: true } } } },
    },
    orderBy: { createdAt: "asc" },
  });

  // 依 家戶|category|核心名|陽上人|地址 分組。
  const groups = new Map<string, typeof entries>();
  for (const e of entries) {
    const hh = e.universalSalvation?.ritualRecord?.householdId ?? "";
    const core = norm(normalizeRitualNameForStore(e.category, e.displayName));
    const yang = yangKey(e.yangshangNames as string[] | null, e.yangshangName);
    const addr = norm(e.tabletAddress);
    const key = `${hh}|${e.category}|${core}|${yang}|${addr}`;
    const g = groups.get(key);
    if (g) g.push(e);
    else groups.set(key, [e]);
  }

  const dupGroups: DedupGroup[] = [];
  const toRemove: { entryId: string; registrationItemId: string | null }[] = [];
  for (const [key, g] of groups) {
    if (g.length < 2) continue;
    const hh = key.split("|")[0];
    // 保留：有地址者優先，其次最早建立。
    const sorted = [...g].sort((a, b) => {
      const aHas = norm(a.tabletAddress) ? 1 : 0;
      const bHas = norm(b.tabletAddress) ? 1 : 0;
      if (aHas !== bHas) return bHas - aHas;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const keepId = sorted[0].id;
    dupGroups.push({
      householdId: hh,
      category: g[0].category,
      coreName: normalizeRitualNameForStore(g[0].category, g[0].displayName),
      yangshang: (Array.isArray(g[0].yangshangNames) && g[0].yangshangNames.length ? (g[0].yangshangNames as string[]) : g[0].yangshangName ? [g[0].yangshangName] : []).join("、"),
      rows: sorted.map((e) => ({
        entryId: e.id,
        registrationItemId: e.registrationItem?.id ?? null,
        displayName: e.displayName,
        category: e.category,
        yangshang: (Array.isArray(e.yangshangNames) && e.yangshangNames.length ? (e.yangshangNames as string[]) : e.yangshangName ? [e.yangshangName] : []).join("、"),
        address: e.tabletAddress,
        createdAt: e.createdAt.toISOString(),
        keep: e.id === keepId,
      })),
    });
    for (const e of sorted) if (e.id !== keepId) toRemove.push({ entryId: e.id, registrationItemId: e.registrationItem?.id ?? null });
  }

  const base: DedupCreditorUnbornReport = {
    ok: true,
    commit,
    year,
    totalEntries: entries.length,
    duplicateGroups: dupGroups.length,
    groups: dupGroups,
  };
  if (!commit || toRemove.length === 0) return base;

  let cancelled = 0;
  const blocked: { entryId: string; reason: string }[] = [];
  for (const r of toRemove) {
    if (r.registrationItemId) {
      // 走既有安全流程：取消計價項目＋軟刪牌位；已收款／已列印會被擋下。
      const res = await removeRegisteredItem(r.registrationItemId, opts.operatorName ?? "系統：冤親／無緣重複清理");
      if (res.ok) cancelled += 1;
      else blocked.push({ entryId: r.entryId, reason: res.error });
    } else {
      // 沒有連動計價項目 → 直接軟刪牌位。
      await prisma.universalSalvationEntry.updateMany({
        where: { id: r.entryId, deletedAt: null },
        data: { deletedAt: new Date(), deletedByName: opts.operatorName ?? "系統：冤親／無緣重複清理" },
      });
      cancelled += 1;
    }
  }
  return { ...base, cancelled, blocked };
}
