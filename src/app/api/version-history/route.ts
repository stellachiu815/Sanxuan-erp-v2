import { NextRequest, NextResponse } from "next/server";
import { getVersionHistory } from "@/lib/recordVersion";

/**
 * 查詢某一筆資料的完整修改歷史（V8.0「資料版本紀錄」）。
 *
 * GET /api/version-history?entityType=Household&entityId=F00009
 */
export async function GET(request: NextRequest) {
  const entityType = request.nextUrl.searchParams.get("entityType")?.trim() ?? "";
  const entityId = request.nextUrl.searchParams.get("entityId")?.trim() ?? "";

  if (!entityType || !entityId) {
    return NextResponse.json({ error: "請提供 entityType 與 entityId" }, { status: 400 });
  }

  const versions = await getVersionHistory(entityType, entityId);
  return NextResponse.json({ versions });
}
