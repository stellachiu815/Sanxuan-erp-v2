import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ActivityType } from "@prisma/client";
import { createTempleEvent, listTempleEvents } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 宮務活動中心：活動清單／建立新活動（活動精靈 Step2＋Step3①）。
 *
 * GET  /api/temple-events?activityType=GUANGMING_LANTERN（activityType 選填，不帶就回傳全部活動類型）
 * POST /api/temple-events
 *   body: {
 *     "activityType": "GUANGMING_LANTERN",
 *     "year": 115,
 *     "name": "民國一一五年度光明燈",   // 選填，不填自動組字
 *     "lunarDateYear": 2026, "lunarDateMonth": 1, "lunarDateDay": 1, "lunarDateIsLeap": false,  // 選填
 *     "solarDate": "2026-02-17",       // 選填
 *     "status": "PREPARING",           // 選填
 *     "note": "備註",                   // 選填
 *     "operatorName": "操作人姓名"
 *   }
 *
 * 祭改（PURIFICATION）委派給 src/lib/purification.ts 既有的建立邏輯，其他
 * 活動類型走通用建立流程，見 src/lib/templeEvents.ts。
 */
export async function GET(request: NextRequest) {
  const activityTypeParam = request.nextUrl.searchParams.get("activityType");
  const activityType =
    activityTypeParam && (Object.values(ActivityType) as string[]).includes(activityTypeParam)
      ? (activityTypeParam as ActivityType)
      : undefined;
  const events = await listTempleEvents(activityType);
  return NextResponse.json({ events });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const activityType = body.activityType;
  if (!activityType || !(Object.values(ActivityType) as string[]).includes(activityType)) {
    return NextResponse.json({ error: "請選擇正確的活動類型" }, { status: 400 });
  }
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 1) {
    return NextResponse.json({ error: "請提供正確的民國年度（year）" }, { status: 400 });
  }

  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "create");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;

  const result = await createTempleEvent(
    {
      activityType,
      year,
      name: typeof body.name === "string" ? body.name : null,
      lunarDateYear: Number.isInteger(body.lunarDateYear) ? body.lunarDateYear : null,
      lunarDateMonth: Number.isInteger(body.lunarDateMonth) ? body.lunarDateMonth : null,
      lunarDateDay: Number.isInteger(body.lunarDateDay) ? body.lunarDateDay : null,
      lunarDateIsLeap: Boolean(body.lunarDateIsLeap),
      solarDate: typeof body.solarDate === "string" && body.solarDate ? new Date(body.solarDate) : null,
      status: typeof body.status === "string" ? body.status : undefined,
      note: typeof body.note === "string" ? body.note : null,
    },
    operatorName
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/activities");

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
