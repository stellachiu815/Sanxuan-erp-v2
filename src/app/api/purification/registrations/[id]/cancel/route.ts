import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { cancelPurificationRegistration } from "@/lib/purification";
import { assertPurificationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

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

  await request.json().catch(() => ({}));
  const __op = await assertPurificationPermissionForOperator(await readOperatorUserId(request), "update");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });

  const result = await cancelPurificationRegistration(id, __op.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification");

  return NextResponse.json({ id: result.data.id });
}
