import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { restoreCancelledAdditionalPrintItem } from "@/lib/additionalPrintItems";

/**
 * 恢復一筆已取消的附加列印項目（依照是否已列印過，回到「待列印」或「已
 * 列印」狀態）。⚠️ 這是「取消 → 恢復」這一對操作，跟系統整體的「回收區
 * 還原」（.../print-items/[itemId]/delete → /api/recycle-bin/restore）是
 * 兩個不同流程，見 src/lib/additionalPrintItems.ts 的說明。
 *
 * POST /api/households/F00009/rituals/universal-salvation/115/entries/xxx/print-items/yyy/restore
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

  const result = await restoreCancelledAdditionalPrintItem(householdId, year, entryId, itemId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ item: result.item });
}
