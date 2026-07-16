import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { ActivityType } from "@prisma/client";
import { copyTempleEventFromPrevious } from "@/lib/templeEvents";

/**
 * 活動精靈 Step3②「複製去年活動」。
 *
 * POST /api/temple-events/copy-from-previous
 * body: {
 *   "activityType": "GUANGMING_LANTERN",
 *   "newYear": 116,
 *   "sourceEventId": "xxx",
 *   "copyParticipants": true,   // □ 去年參加名單
 *   "copySettings": true,       // □ 去年設定
 *   "copyFees": false,          // □ 去年收費
 *   "operatorName": "操作人姓名"
 * }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const activityType = body.activityType;
  if (!activityType || !(Object.values(ActivityType) as string[]).includes(activityType)) {
    return NextResponse.json({ error: "請選擇正確的活動類型" }, { status: 400 });
  }
  const newYear = Number(body.newYear);
  if (!Number.isInteger(newYear) || newYear < 1) {
    return NextResponse.json({ error: "請提供正確的新年度" }, { status: 400 });
  }
  const sourceEventId = typeof body.sourceEventId === "string" ? body.sourceEventId : "";
  if (!sourceEventId) {
    return NextResponse.json({ error: "請選擇來源活動年度" }, { status: 400 });
  }

  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await copyTempleEventFromPrevious(
    activityType,
    newYear,
    sourceEventId,
    {
      copyParticipants: Boolean(body.copyParticipants),
      copySettings: Boolean(body.copySettings),
      copyFees: Boolean(body.copyFees),
    },
    operatorName
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/activities");

  return NextResponse.json({ id: result.data.id, diffs: result.data.diffs }, { status: 201 });
}
