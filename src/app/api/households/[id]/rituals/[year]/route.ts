import { NextRequest, NextResponse } from "next/server";
import { getRitualYearSnapshot } from "@/lib/ritual";

/**
 * 年度快照 API（V5.1「年度快照」新增）。
 *
 * GET /api/households/F00009/rituals/115
 *
 * 一次回傳某戶、某年度「所有」祭祀活動類型的資料（目前只有普渡有實際
 * 內容，年度燈/宮慶尚未開發，固定回傳 null）。跟既有的
 * GET .../universal-salvation/[year]（只回普渡一種）不衝突，是未來
 * 「一個年度、全部活動類型」的通用入口，之後年度燈/宮慶開發好後，直接
 * 沿用同一支 API，不用改網址。
 *
 * 只查詢、不修改任何資料，固定用 (householdId, year) 篩選，不會影響其他
 * 年度。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string }> }
) {
  const { id: householdId, year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const result = await getRitualYearSnapshot(householdId, year);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.snapshot);
}
