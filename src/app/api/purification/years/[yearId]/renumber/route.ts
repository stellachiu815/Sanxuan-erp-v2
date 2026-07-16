import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { renumberPurificationYear } from "@/lib/purification";

/**
 * 重新編號整批重排（需求「七」：只有尚未正式列印、管理者明確二次確認
 * 才可以執行）。
 *
 * POST /api/purification/years/xxx/renumber
 * body: { "confirm": true, "operatorName": "操作人姓名" }
 *
 * confirm 必須明確是 true——真正的警告文字/二次確認畫面在前端 ConfirmDialog
 * 呈現（見需求「七」：「重新編號前必須顯示警告並二次確認」），這裡的
 * confirm 只是確保 API 不會被意外的裸 POST 請求觸發。
 *
 * 年度一旦鎖定（isLocked=true，已經開始列印過），這支一律回傳 409，
 * 不允許重新編號。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ yearId: string }> }
) {
  const { yearId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const confirm = body.confirm === true;
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await renumberPurificationYear(yearId, confirm, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/purification/${yearId}`);

  return NextResponse.json({ reassignedCount: result.data.reassignedCount });
}
