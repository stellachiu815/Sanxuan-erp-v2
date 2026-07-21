import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  generateAdditionalPrintItemBatch,
  listPrintItemsForPrintCenter,
  type PrintCenterFilters,
} from "@/lib/additionalPrintItems";

import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
/**
 * 普渡列印中心：產生列印批次（需求「九」：全部列印/只印預設寶袋/只印額外
 * 寶袋/指定寶袋補印/指定家戶列印/指定名稱搜尋，都是同一支 API，只是
 * filter 不一樣——設計對應 /api/purification/years/xxx/print-batches 的
 * 既有慣例）。
 *
 * POST /api/universal-salvation/115/print-items/print-batches
 * body: {
 *   "filter": { "kind": "ALL" }
 *          或 { "kind": "DEFAULT_ONLY" }              // 只印預設寶袋
 *          或 { "kind": "EXTRA_ONLY" }                // 只印額外寶袋
 *          或 { "kind": "IDS", "ids": ["xxx", "yyy"] } // 指定寶袋列印／補印
 *          或 { "kind": "FILTER", "filters": { "householdId": "F00009" } }  // 指定家戶列印
 *          或 { "kind": "FILTER", "filters": { "printName": "王" } }        // 指定名稱搜尋
 *   "printedByName": "操作人姓名",
 *   "templateVersionId": "xxx",   // 選填
 *   "operatorName": "操作人姓名"
 * }
 *
 * ⚠️「產生PDF」本輪只完成資料格式與批次紀錄，沙盒環境無法真的產生二進位
 * PDF 檔案，見交付說明的誠實限制章節；「儲存列印批次」由這支 API 本身
 * 建立 TempleEventPrintBatch 完成，不需要另一支 API。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "print");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object" || !body.filter || typeof body.filter !== "object") {
    return NextResponse.json({ error: "請提供正確的篩選條件（filter）" }, { status: 400 });
  }

  const rawFilter = body.filter as Record<string, unknown>;
  let itemIds: string[];

  switch (rawFilter.kind) {
    case "ALL": {
      const items = await listPrintItemsForPrintCenter(year, {});
      itemIds = items.filter((i) => i.status !== "CANCELLED" && i.status !== "PENDING_CONFIRMATION").map((i) => i.id);
      break;
    }
    case "DEFAULT_ONLY": {
      const items = await listPrintItemsForPrintCenter(year, { isExtra: false });
      itemIds = items.filter((i) => i.status !== "CANCELLED" && i.status !== "PENDING_CONFIRMATION").map((i) => i.id);
      break;
    }
    case "EXTRA_ONLY": {
      const items = await listPrintItemsForPrintCenter(year, { isExtra: true });
      itemIds = items.filter((i) => i.status !== "CANCELLED" && i.status !== "PENDING_CONFIRMATION").map((i) => i.id);
      break;
    }
    case "IDS": {
      const ids = Array.isArray(rawFilter.ids) ? rawFilter.ids.filter((x): x is string => typeof x === "string") : [];
      if (ids.length === 0) {
        return NextResponse.json({ error: "請提供要列印的 id 清單" }, { status: 400 });
      }
      itemIds = ids;
      break;
    }
    case "FILTER": {
      const filters: PrintCenterFilters =
        rawFilter.filters && typeof rawFilter.filters === "object" ? (rawFilter.filters as PrintCenterFilters) : {};
      const items = await listPrintItemsForPrintCenter(year, filters);
      itemIds = items.filter((i) => i.status !== "CANCELLED" && i.status !== "PENDING_CONFIRMATION").map((i) => i.id);
      break;
    }
    default:
      return NextResponse.json({ error: "篩選條件的 kind 不正確" }, { status: 400 });
  }

  if (itemIds.length === 0) {
    return NextResponse.json({ error: "沒有符合條件、可以列印的項目" }, { status: 400 });
  }

  const printedByName = check.operator.name;
  const templateVersionId = typeof body.templateVersionId === "string" ? body.templateVersionId : null;
  const operatorName = check.operator.name;

  const result = await generateAdditionalPrintItemBatch(
    itemIds,
    { printedByName, templateVersionId },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/rituals/universal-salvation/print-center");

  return NextResponse.json(
    { batchId: result.batchId, printedCount: result.printedCount, reprintedCount: result.reprintedCount },
    { status: 201 }
  );
}
