import { prisma } from "@/lib/prisma";
import { confirmPrintObjects } from "@/lib/additionalPrintItems";

/**
 * 「把某時間點之前建立的未列印物件，一次補登記為已列印」。
 *
 * 用途：宮裡在系統外實際印了一大批（沒走到「確認完成列印」），系統仍顯示未列印、
 * 批次列印會想重印。這個工具用**建立時間**當依據（某時間前建立＝當時已印），
 * 並依**紙張類別**分桶讓使用者選（黃：祖先/乙位；粉紅：冤親/無緣；紅：寶袋），
 * 只把選到的補登記為已列印。套用時走既有 confirmPrintObjects（同一支已驗證後端，
 * printCount+1、批次、冪等都沿用），不另寫列印核心。
 *
 * 分桶依據：POCKET→寶袋(紅)；TABLET 再看來源牌位類別→祖先/乙位(黃) 或 冤親/無緣(粉紅)。
 */

export type PaperBucket = "ancestor-soul" | "creditor-unborn" | "pocket";

const YELLOW = new Set(["ANCESTOR_LINE", "INDIVIDUAL_SOUL"]);
const PINK = new Set(["DEBT_CREDITOR", "UNBORN_CHILD"]);

type Candidate = { id: string; bucket: PaperBucket };

/** 撈出「year 年度、before 之前建立、仍未列印」的列印物件，並分桶。 */
async function collectCandidates(year: number, before: Date): Promise<Candidate[]> {
  const rows = await prisma.additionalPrintItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      printCount: { lte: 0 },
      createdAt: { lt: before },
      ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
    },
    select: { id: true, itemType: true, sourceEntryId: true },
  });

  // TABLET 需要來源牌位類別來分「黃 / 粉紅」；一次撈齊（非 N+1）。
  const tabletSourceIds = [...new Set(rows.filter((r) => r.itemType === "TABLET").map((r) => r.sourceEntryId))];
  const entries = tabletSourceIds.length
    ? await prisma.universalSalvationEntry.findMany({ where: { id: { in: tabletSourceIds } }, select: { id: true, category: true } })
    : [];
  const catById = new Map(entries.map((e) => [e.id, e.category]));

  const out: Candidate[] = [];
  for (const r of rows) {
    if (r.itemType === "POCKET") { out.push({ id: r.id, bucket: "pocket" }); continue; }
    const cat = catById.get(r.sourceEntryId) ?? "";
    if (YELLOW.has(cat)) out.push({ id: r.id, bucket: "ancestor-soul" });
    else if (PINK.has(cat)) out.push({ id: r.id, bucket: "creditor-unborn" });
    // 其他（理論上不會有）不納入，避免誤標。
  }
  return out;
}

export type MarkPrintedPreview = {
  ok: true;
  year: number;
  before: string;
  counts: { "ancestor-soul": number; "creditor-unborn": number; pocket: number; total: number };
};

/** 預覽：各桶有幾筆符合（純讀取，不寫入）。 */
export async function previewMarkPrintedBefore(year: number, before: Date): Promise<MarkPrintedPreview> {
  const cands = await collectCandidates(year, before);
  const counts = { "ancestor-soul": 0, "creditor-unborn": 0, pocket: 0, total: cands.length };
  for (const c of cands) counts[c.bucket]++;
  return { ok: true, year, before: before.toISOString(), counts };
}

/** 套用：只把「選到的紙張類別」補登記為已列印。走 confirmPrintObjects（同一支後端）。 */
export async function applyMarkPrintedBefore(
  year: number,
  before: Date,
  buckets: PaperBucket[],
  actor: { userId: string; operatorName?: string | null }
): Promise<{ ok: true; marked: number } | { ok: false; status: number; error: string }> {
  const wanted = new Set(buckets);
  if (wanted.size === 0) return { ok: false, status: 400, error: "請至少選一種紙張類別" };
  const cands = (await collectCandidates(year, before)).filter((c) => wanted.has(c.bucket));
  if (cands.length === 0) return { ok: true, marked: 0 };

  const ids = cands.map((c) => c.id);
  // 決定性冪等鍵：同一組（年度＋時間＋類別）重跑不重複累加（confirmPrintObjects 會 dedup）。
  const idempotencyKey = `mark-before:${year}:${before.toISOString()}:${[...wanted].sort().join(",")}`;
  const res = await confirmPrintObjects(ids, { userId: actor.userId, operatorName: actor.operatorName ?? null, idempotencyKey });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  return { ok: true, marked: (res.printedCount ?? 0) + (res.reprintedCount ?? 0) };
}
