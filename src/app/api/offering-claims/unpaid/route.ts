import { NextRequest, NextResponse } from "next/server";
import { listOfferingClaims } from "@/lib/offeringClaims";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * 需求「七、十六」：未收款清單／跨年度未收款提醒，跨活動、跨年度查詢。
 * GET /api/offering-claims/unpaid                → 全部未收款/部分收款
 * GET /api/offering-claims/unpaid?crossYear=1     → 只顯示跨年度未收款
 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams;
  const onlyCrossYear = sp.get("crossYear") === "1";
  const currentYear = sp.get("year") ? Number(sp.get("year")) : getCurrentRitualYear();

  const claims = await listOfferingClaims({
    onlyUnpaid: true,
    onlyCrossYearUnpaid: onlyCrossYear,
    currentYear,
    sponsorHouseholdId: sp.get("householdId") ?? undefined,
  });
  return NextResponse.json({ claims, currentYear });
}
