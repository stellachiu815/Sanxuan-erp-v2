import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getRiceQuotaSummary } from "@/lib/whiteRiceService";

/**
 * V14.4：以「年度」解析白米配額摘要（給普渡報名編輯器用；它只有 year、沒有
 * templeEventId）。沿用同一個 getRiceQuotaSummary（不另建第二套查詢）。
 * GET /api/universal-salvation/[year]/rice-config
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const event = await prisma.templeEvent.findFirst({
    where: { activityType: "UNIVERSAL_SALVATION", year },
    select: { id: true },
  });
  if (!event) return NextResponse.json({ error: `尚未建立民國 ${year} 年的中元普渡活動` }, { status: 404 });

  const summary = await getRiceQuotaSummary(event.id);
  if (!summary) return NextResponse.json({ error: "找不到年度配額" }, { status: 404 });
  return NextResponse.json({ ok: true, templeEventId: event.id, ...summary });
}
