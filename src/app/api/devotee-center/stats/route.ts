import { NextRequest, NextResponse } from "next/server";
import { getDevoteeHomeStats, getDevoteeRecentLists } from "@/lib/devoteeStats";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/stats?operatorUserId=xxx
 * 對應指令「四」：信眾關係中心首頁的 10 張統計卡片 + 7 份最近清單。
 * 全部即時查詢既有資料表算出來，見 src/lib/devoteeStats.ts 檔案說明。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const now = new Date();
  const [stats, recentLists] = await Promise.all([getDevoteeHomeStats(now), getDevoteeRecentLists(now)]);
  return NextResponse.json({ stats, recentLists });
}
