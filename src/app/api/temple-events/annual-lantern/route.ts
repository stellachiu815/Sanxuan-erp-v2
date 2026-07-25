import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAnnualLanternGroup } from "@/lib/templeEvents";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V15R4 年度燈統一（方案A）：一次建立/沿用「年度燈」底下的四個既有活動
 * （光明燈 / 太歲燈 / 全家燈 / 祭改），共用同一年度、同一年度帳本。
 *
 * POST /api/temple-events/annual-lantern
 *   body: { year, solarDate?, lunarDate*?, note?, operatorName? }
 *
 * 冪等：已存在的子活動略過、只補缺的；回傳 landing（光明燈）活動 id 供導向。
 * 不新增 schema、不建平行資料模型（沿用 createTempleEvent / createPurificationYear）。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 1) {
    return NextResponse.json({ error: "請提供正確的民國年度（year）" }, { status: 400 });
  }

  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "create");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await createAnnualLanternGroup(
    {
      year,
      lunarDateYear: Number.isInteger(body.lunarDateYear) ? body.lunarDateYear : null,
      lunarDateMonth: Number.isInteger(body.lunarDateMonth) ? body.lunarDateMonth : null,
      lunarDateDay: Number.isInteger(body.lunarDateDay) ? body.lunarDateDay : null,
      lunarDateIsLeap: Boolean(body.lunarDateIsLeap),
      solarDate: typeof body.solarDate === "string" && body.solarDate ? new Date(body.solarDate) : null,
      note: typeof body.note === "string" ? body.note : null,
    },
    __op.operator.name
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/activities");

  // landing = 單一年度燈活動 id（導向既有 /activities/[id] 管理畫面）。
  return NextResponse.json({ id: result.data.landingId, year: result.data.year }, { status: 201 });
}
