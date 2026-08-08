import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { resolvePrintCenterActivities } from "@/lib/printCenterOverview";

/**
 * V39 列印中心總覽：每個活動群組各自帶對年度＋當季判斷＋該年度彙總。
 * GET /api/print-center/overview?operatorUserId=xxx
 *
 * 取代舊「單一寫死年度」的作法——普渡自動帶當年、年度燈自動帶隔年。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(
    await readOperatorUserId(request),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const activities = await resolvePrintCenterActivities();
  return NextResponse.json({ ok: true, activities });
}
