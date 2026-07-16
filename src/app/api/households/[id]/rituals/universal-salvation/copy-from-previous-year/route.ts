import { NextRequest, NextResponse } from "next/server";
import { copyUniversalSalvationFromPreviousYear } from "@/lib/ritual";

/**
 * 「複製去年資料」API。
 *
 * POST /api/households/F00009/rituals/universal-salvation/copy-from-previous-year
 * body: {
 *   "targetYear": 115,     // 必填：要建立的年度
 *   "sourceYear": 114      // 選填：來源年度，不填預設是 targetYear - 1
 * }
 *
 * 例如 115 年建立普渡時，可以直接複製 114 年資料當作起點。目標年度如果
 * 已經有資料，不會覆蓋，會回傳錯誤。
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

  const targetYear = Number(body.targetYear);
  if (!Number.isInteger(targetYear)) {
    return NextResponse.json({ error: "請提供正確的目標年度（targetYear）" }, { status: 400 });
  }

  let sourceYear: number | undefined;
  if (body.sourceYear !== undefined && body.sourceYear !== null) {
    sourceYear = Number(body.sourceYear);
    if (!Number.isInteger(sourceYear)) {
      return NextResponse.json({ error: "來源年度（sourceYear）格式錯誤" }, { status: 400 });
    }
  }

  const result = await copyUniversalSalvationFromPreviousYear(householdId, targetYear, sourceYear);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ record: result.record }, { status: 201 });
}
