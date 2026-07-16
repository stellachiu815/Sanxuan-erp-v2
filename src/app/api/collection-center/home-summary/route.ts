import { NextResponse } from "next/server";
import { getCollectionHomeSummary } from "@/lib/collectionCenter";
import { getCurrentRitualYear } from "@/lib/ritual";

/** GET /api/collection-center/home-summary — 首頁提醒卡用的彙總數字。 */
export async function GET() {
  const summary = await getCollectionHomeSummary(getCurrentRitualYear());
  return NextResponse.json(summary);
}
