import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cancelPurificationRegistration } from "@/lib/purification";

/**
 * 取消一筆祭改報名（需求「七」：保留原編號、狀態改為取消，不會把編號
 * 讓給後面的人使用，也不會讓後面所有人重新編號）。
 *
 * POST /api/purification/registrations/xxx/cancel
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await request.json().catch(() => ({}));
  const operatorName =
    body && typeof body === "object" && typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await cancelPurificationRegistration(id, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification");

  return NextResponse.json({ id: result.data.id });
}
