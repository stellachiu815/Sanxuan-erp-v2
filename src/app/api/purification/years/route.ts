import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createPurificationYear, listPurificationYears } from "@/lib/purification";
import { assertPurificationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 祭改年度清單／建立新年度。
 *
 * GET  /api/purification/years
 * POST /api/purification/years
 *   body: { "year": 115, "operatorName": "操作人姓名" }
 *
 * 每一年度只建立一次（year 唯一），不含「沿用去年」——那是另一支 API
 * （見 ./copy-from-previous/route.ts），因為沿用去年會多做「複製報名資料
 * ＋差異比對」，回傳格式跟這支不一樣，分開兩支路由比較清楚。
 */
export async function GET() {
  const years = await listPurificationYears();
  return NextResponse.json({ years });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 1) {
    return NextResponse.json({ error: "請提供正確的民國年度（year）" }, { status: 400 });
  }

  const __op = await assertPurificationPermissionForOperator(await readOperatorUserId(request), "manageYears");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await createPurificationYear(year, __op.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification");

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
