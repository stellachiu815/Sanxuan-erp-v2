import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listActivityItemPrintSummary } from "@/lib/printDocuments";
import { getCurrentRitualYear } from "@/lib/ritual";

/**
 * V14：列印管理中央入口資料——某年度所有活動報名項目的列印彙總。
 * GET /api/print-center/activity-items?year=115&operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : getCurrentRitualYear();
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const summary = await listActivityItemPrintSummary(year);
  return NextResponse.json({ ok: true, year, summary });
}
