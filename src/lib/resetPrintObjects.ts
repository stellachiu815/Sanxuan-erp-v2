import { prisma } from "@/lib/prisma";
import { recordVersion } from "@/lib/recordVersion";

/**
 * 把列印物件「重設為未列印」（取消列印登記）。
 *
 * 用途：手滑把不該標記的牌位標成已列印時，可乾淨退回未列印，讓它重新進入
 * 批次列印。只動**列印狀態**（printCount／時間戳／status），**不動收款、不動內容、
 * 不刪資料**。每筆記 recordVersion 可追溯。分批處理避免單一交易過大。
 */
export async function resetPrintObjectsToUnprinted(
  itemIds: string[],
  operatorName?: string | null
): Promise<{ ok: true; reset: number } | { ok: false; status: number; error: string }> {
  const ids = [...new Set(itemIds.filter((x) => typeof x === "string" && x))];
  if (ids.length === 0) return { ok: false, status: 400, error: "請至少選擇一筆要重設的項目" };

  const items = await prisma.additionalPrintItem.findMany({ where: { id: { in: ids }, deletedAt: null } });
  if (items.length === 0) return { ok: true, reset: 0 };

  const CHUNK = 25;
  let reset = 0;
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await prisma.$transaction(async (tx) => {
      for (const item of chunk) {
        // 已經是未列印的略過（不產生無意義的版本紀錄）。
        if ((item.printCount ?? 0) <= 0 && !item.isPrinted) continue;
        const after = await tx.additionalPrintItem.update({
          where: { id: item.id },
          data: {
            printCount: 0,
            firstPrintedAt: null,
            lastPrintedAt: null,
            lastPrintedByUserId: null,
            isPrinted: false,
            printedAt: null,
            printedByName: null,
            printedQuantity: 0,
            reprintCount: 0,
            printBatchId: null,
            status: "PENDING_PRINT",
          },
        });
        await recordVersion(
          {
            entityType: "AdditionalPrintItem",
            entityId: item.id,
            action: "UPDATE",
            beforeData: item,
            afterData: after,
            operatorName,
            changeNote: "重設為未列印（取消列印登記）",
          },
          tx
        );
        reset++;
      }
    });
  }
  return { ok: true, reset };
}
