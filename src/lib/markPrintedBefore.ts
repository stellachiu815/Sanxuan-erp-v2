import { prisma } from "@/lib/prisma";
import { confirmPrintObjects } from "@/lib/additionalPrintItems";
import { batchOf } from "@/lib/TabletBatchService";

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

// 桶＝系統批次分類（與列印中心 batchOf 完全一致）：
//   ancestor-soul＝祖先/乙位/**本宅地基主**（黃紙）；creditor＝冤親/無緣（粉紅）；pocket＝寶袋（紅）。
// ⚠️ 一定要用 batchOf,不能只看原始類別——「本宅地基主」類別雖是 UNBORN_CHILD,
//    但實際歸黃紙批次;過去照原始類別分粉紅,導致勾粉紅時誤標地基主(Stella 實測回報)。
export type PaperBucket = "ancestor-soul" | "creditor" | "pocket";

type Candidate = { id: string; bucket: PaperBucket };

/** 撈出「year 年度、before 之前建立、仍未列印」的列印物件，並用 batchOf 分桶。 */
async function collectCandidates(year: number, before: Date): Promise<Candidate[]> {
  const rows = await prisma.additionalPrintItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      printCount: { lte: 0 },
      createdAt: { lt: before },
      ritualRecord: { year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
    },
    select: { id: true, itemType: true, sourceEntryId: true, printName: true },
  });

  // TABLET 需要來源牌位類別＋主文名（判「地基主」）；一次撈齊（非 N+1）。
  const tabletSourceIds = [...new Set(rows.filter((r) => r.itemType === "TABLET").map((r) => r.sourceEntryId))];
  const entries = tabletSourceIds.length
    ? await prisma.universalSalvationEntry.findMany({ where: { id: { in: tabletSourceIds } }, select: { id: true, category: true, displayName: true } })
    : [];
  const entryById = new Map(entries.map((e) => [e.id, e]));

  const out: Candidate[] = [];
  for (const r of rows) {
    const entry = entryById.get(r.sourceEntryId);
    // batchOf：POCKET→pocket；TABLET 依類別＋主文（地基主→黃）分流，與列印中心一致。
    const bucket = batchOf({
      itemType: r.itemType,
      sourceCategory: entry?.category ?? "",
      printMainText: r.printName ?? null,
      sourceDisplayName: entry?.displayName ?? "",
    });
    if (bucket) out.push({ id: r.id, bucket });
  }
  return out;
}

export type MarkPrintedPreview = {
  ok: true;
  year: number;
  before: string;
  counts: { "ancestor-soul": number; creditor: number; pocket: number; total: number };
};

/** 預覽：各桶有幾筆符合（純讀取，不寫入）。 */
export async function previewMarkPrintedBefore(year: number, before: Date): Promise<MarkPrintedPreview> {
  const cands = await collectCandidates(year, before);
  const counts = { "ancestor-soul": 0, creditor: 0, pocket: 0, total: cands.length };
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
  // ⚠️ 分批：confirmPrintObjects 用單一互動式交易，一次上百筆會超過交易逾時
  //（Prisma「Transaction not found」）。每批 25 筆、各自一個決定性冪等鍵，
  // 重跑同一批會 dedup、不重複累加；某批失敗前面已成功的仍保留。
  const baseKey = `mark-before:${year}:${before.toISOString()}:${[...wanted].sort().join(",")}`;
  const CHUNK = 25;
  let marked = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    const res = await confirmPrintObjects(chunk, {
      userId: actor.userId,
      operatorName: actor.operatorName ?? null,
      idempotencyKey: `${baseKey}:chunk${Math.floor(i / CHUNK)}`,
    });
    if (!res.ok) return { ok: false, status: res.status, error: `已標記 ${marked} 筆後發生錯誤：${res.error}（可再按一次繼續，已標記的不會重複）` };
    marked += (res.printedCount ?? 0) + (res.reprintedCount ?? 0);
  }
  return { ok: true, marked };
}
