import { NextRequest, NextResponse } from "next/server";
import { listPendingReceivables } from "@/lib/collectionCenter";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * GET /api/collection-center/pending
 *   query: ?sponsorMemberId=xxx&sponsorHouseholdId=xxx&onlyCrossYear=1
 * 需求「待收款項」「快速收款」共用：目前所有已串接來源的未收/部分收款清單。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const currentYear = getCurrentRitualYear();
  const rows = await listPendingReceivables({
    currentYear,
    sponsorMemberId: searchParams.get("sponsorMemberId") ?? undefined,
    sponsorHouseholdId: searchParams.get("sponsorHouseholdId") ?? undefined,
    onlyCrossYear: searchParams.get("onlyCrossYear") === "1",
  });
  return NextResponse.json({ currentYear, rows });
}
