import { NextResponse } from "next/server";
import { getTempleEventHome } from "@/lib/templeEvents";

/**
 * 活動首頁（需求「四」✓建立活動首頁 ✓建立統計資料，統計資料即時查詢計算）。
 *
 * GET /api/temple-events/xxx
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const home = await getTempleEventHome(id);
  if (!home) {
    return NextResponse.json({ error: "找不到這個活動" }, { status: 404 });
  }
  return NextResponse.json(home);
}
