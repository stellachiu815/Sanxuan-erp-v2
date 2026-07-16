import { NextRequest, NextResponse } from "next/server";
import { searchAcrossTemple } from "@/lib/devoteeSearch";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/search?operatorUserId=xxx&q=關鍵字
 * 對應指令「十二、全宮整合搜尋」：跨模組即時查詢，見
 * src/lib/devoteeSearch.ts（9 分類、每個結果附可跳轉的原始頁面連結）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const q = searchParams.get("q") ?? "";
  const result = await searchAcrossTemple(q);
  return NextResponse.json(result);
}
