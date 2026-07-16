import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createBlankUniversalSalvationRecord } from "@/lib/ritual";

/**
 * 建立一筆全新、空白的普渡登記（不複製任何資料）。
 *
 * POST /api/households/F00009/rituals/universal-salvation
 * body: { "year": 115 }
 *
 * V3.0「普渡登記 UI」用在使用者回答「今年跟去年不一樣」時，直接從空白
 * 開始登記。目標年度已有資料時回傳 409，不會覆蓋既有資料。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: householdId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const year = Number(body.year);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "請提供正確的年度（year）" }, { status: 400 });
  }

  const result = await createBlankUniversalSalvationRecord(householdId, year);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ record: result.record }, { status: 201 });
}
