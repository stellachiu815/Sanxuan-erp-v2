import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cancelAdditionalPrintItem } from "@/lib/additionalPrintItems";

/**
 * 取消一筆附加列印項目（需求「十三」：狀態改為取消，保留列印歷史，
 * 不再出現在待列印清單，可透過 .../restore 恢復）。
 *
 * POST /api/households/F00009/rituals/universal-salvation/115/entries/xxx/print-items/yyy/cancel
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string; itemId: string }> }
) {
  const { id: householdId, year: yearParam, entryId, itemId } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const operatorName =
    body && typeof body === "object" && typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await cancelAdditionalPrintItem(householdId, year, entryId, itemId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ item: result.item });
}
