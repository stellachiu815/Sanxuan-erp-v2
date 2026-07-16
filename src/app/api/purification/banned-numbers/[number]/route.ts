import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { removeBannedNumber } from "@/lib/purification";

/**
 * 移除一個「額外」禁用的號碼（不影響寫死在程式邏輯裡的「連續 44」規則，
 * 那條規則沒有辦法、也不應該被移除）。
 *
 * DELETE /api/purification/banned-numbers/250
 * body（選填）: { "operatorName": "操作人姓名" }
 *
 * ⚠️ 同 ../route.ts 的說明：「一般工作人員不可修改」這件事目前只能靠
 * 前端隱藏入口，後端還沒有登入機制可以真正擋下，已列入已知風險。
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ number: string }> }
) {
  const { number: numberParam } = await params;

  const number = Number(numberParam);
  if (!Number.isInteger(number)) {
    return NextResponse.json({ error: "號碼格式錯誤" }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const operatorName =
    body && typeof body === "object" && typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await removeBannedNumber(number, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification/settings/banned-numbers");

  return NextResponse.json({ ok: true });
}
