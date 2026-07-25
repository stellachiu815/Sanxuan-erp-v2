import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getUniversalSalvationSponsorPrice } from "@/lib/universalSalvationTabletPricing";

/**
 * V15R2：GET /api/universal-salvation/[year]/sponsor-price
 * 回傳該年度一般贊普（US_SPONSOR）的**固定單價**（TempleEvent.sponsorUnitPrice；null=未設定），
 * 供編輯頁「固定單價」唯讀顯示。view 權限；純讀取、不寫入。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year } = await params;
  const y = Number(year);
  if (!Number.isInteger(y)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const sponsorUnitPrice = await getUniversalSalvationSponsorPrice(y);
  return NextResponse.json({ ok: true, year: y, sponsorUnitPrice });
}
