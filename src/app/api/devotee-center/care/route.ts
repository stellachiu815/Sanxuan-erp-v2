import { NextRequest, NextResponse } from "next/server";
import { listCareList, listSuggestedCareCandidates } from "@/lib/devoteeCare";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/care?operatorUserId=xxx
 * 對應指令「十一、需要關懷名單」：同時回傳「已正式標記」與「系統建議」
 * 兩份清單，兩者在畫面上必須分開顯示（見 src/lib/devoteeCare.ts 說明：
 * 系統不得自行把系統建議直接當成正式標記）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const [flagged, suggested] = await Promise.all([listCareList(), listSuggestedCareCandidates()]);
  return NextResponse.json({ flagged, suggested });
}
