import { NextResponse } from "next/server";
import { getMemberOfferingHistory } from "@/lib/offeringClaims";

/**
 * 需求「十八、歷年查詢」：從信眾資料頁查看某位信眾歷年供品認捐紀錄
 * （大福壽龜/小福壽龜/壽桃麵塔/散壽桃麵/花果供品/其他供品）。
 * GET /api/members/xxx/offering-history
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const history = await getMemberOfferingHistory(id);
  return NextResponse.json({ history });
}
