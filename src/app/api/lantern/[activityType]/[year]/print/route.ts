import { NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { buildLanternPrintBatch, buildPetitionData, LANTERN_ACTIVITY_TYPES } from "@/lib/lanternPrint";
import type { ActivityType } from "@prisma/client";

/**
 * V13.1 指令十一：年度燈列印資料 API。
 *
 * GET /api/lantern/GUANGMING_LANTERN/116/print?operatorUserId=xxx&mode=tablet|petition
 *
 * ⚠️ 年度（116）是**活動使用年度**，由網址明確指定。這支 API 完全不會
 * 用今天日期推年度——民國 115 年呼叫 /116/print 就是拿到 116 年度的
 * 歲數、生肖、太歲、建生瑞生，補印、重印結果永遠一致。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ activityType: string; year: string }> }
) {
  const { searchParams } = new URL(request.url);
  const operatorUserId = await readOperatorUserId(request);

  const check = await assertDevoteePermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { activityType, year: yearParam } = await params;

  if (!LANTERN_ACTIVITY_TYPES.includes(activityType as ActivityType)) {
    return NextResponse.json(
      { error: "活動類型不正確，年度燈僅支援光明燈、太歲燈、全家燈" },
      { status: 400 }
    );
  }

  const year = Number(yearParam);
  if (!Number.isInteger(year) || year < 1) {
    return NextResponse.json({ error: "活動年度格式錯誤" }, { status: 400 });
  }

  const mode = searchParams.get("mode") === "petition" ? "petition" : "tablet";

  if (mode === "petition") {
    const data = await buildPetitionData(activityType as ActivityType, year);
    if (!data) {
      return NextResponse.json(
        { error: `尚未建立民國 ${year} 年的這項年度燈活動，請先於活動中心建立` },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, mode, data });
  }

  const batch = await buildLanternPrintBatch(activityType as ActivityType, year);
  if (!batch) {
    return NextResponse.json(
      { error: `尚未建立民國 ${year} 年的這項年度燈活動，請先於活動中心建立` },
      { status: 404 }
    );
  }

  return NextResponse.json({ ok: true, mode, batch });
}
