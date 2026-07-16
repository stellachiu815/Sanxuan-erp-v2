import { NextRequest, NextResponse } from "next/server";
import { getRitualYearsOverview } from "@/lib/ritual";

/**
 * 年度總覽 API（V5.1「年度快照」新增）。
 *
 * GET /api/households/F00009/rituals/years
 *
 * 回傳：
 * - currentRitualYear / recentYears：今年／去年／前年，供「快速切換」使用
 *   （不管這幾年有沒有資料都會列出）。
 * - years：這一戶「所有已經有祭祀資料」的年度，由新到舊，供「歷史年度
 *   瀏覽」下拉選單使用（不限普渡，未來年度燈/宮慶的資料也會自動一起列出，
 *   因為都存在同一張 RitualRecord 表）。
 *
 * 只查詢、不修改任何資料。
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: householdId } = await params;

  const result = await getRitualYearsOverview(householdId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json(result.overview);
}
