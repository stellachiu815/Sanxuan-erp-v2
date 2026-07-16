import { NextResponse } from "next/server";
import { getAdditionalPrintItemActivitySummary } from "@/lib/additionalPrintItems";

/**
 * 活動摘要（需求「十五」）：這個活動（TempleEvent）底下附加列印項目的
 * 預設寶袋數量／額外寶袋數量／寶袋總數／待列印數量／已列印數量。
 *
 * GET /api/temple-events/xxx/print-items-summary
 *
 * ⚠️ 只統計 activityId 等於這個活動 id 的項目——V10.0 之前就存在、沒有
 * activityId 的既有普渡登記不會被計入任何一個活動的摘要，見
 * src/lib/additionalPrintItems.ts 的 getAdditionalPrintItemActivitySummary()
 * 說明。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const summary = await getAdditionalPrintItemActivitySummary(id);
  return NextResponse.json({ summary });
}
