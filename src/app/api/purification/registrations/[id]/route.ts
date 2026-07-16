import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { updatePurificationRegistration } from "@/lib/purification";

/**
 * 修改一筆祭改報名的收款狀態/金額/備註（臨時報名者另外可以修改地址/電話）。
 *
 * PATCH /api/purification/registrations/xxx
 * body（欄位都選填，只更新有帶到的欄位）: {
 *   "paymentStatus": "PAID",
 *   "paymentAmount": 300,
 *   "notes": "備註",
 *   "manualAddress": "...",   // 只有臨時報名者（isTemporaryName）才會生效
 *   "manualPhone": "...",
 *   "operatorName": "操作人姓名"
 * }
 *
 * 姓名/性別/生日不能透過這支修改——一般報名者的這些欄位一律引用信眾主
 * 資料，要改請去信眾資料頁修改；臨時報名者要「補齊信眾主資料」時，屬於
 * 另一個未來功能（把臨時報名者轉成正式信眾），本次不在範圍內。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };
  const toNullableAmount = (v: unknown): number | null => {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const input: {
    paymentStatus?: "UNPAID" | "PARTIAL" | "PAID";
    paymentAmount?: number | null;
    notes?: string | null;
    manualAddress?: string | null;
    manualPhone?: string | null;
  } = {};

  if ("paymentStatus" in body) {
    if (body.paymentStatus === "UNPAID" || body.paymentStatus === "PARTIAL" || body.paymentStatus === "PAID") {
      input.paymentStatus = body.paymentStatus;
    } else {
      return NextResponse.json({ error: "收款狀態格式錯誤" }, { status: 400 });
    }
  }
  if ("paymentAmount" in body) input.paymentAmount = toNullableAmount(body.paymentAmount);
  if ("notes" in body) input.notes = toNullableString(body.notes);
  if ("manualAddress" in body) input.manualAddress = toNullableString(body.manualAddress);
  if ("manualPhone" in body) input.manualPhone = toNullableString(body.manualPhone);

  const operatorName = toNullableString(body.operatorName);

  const result = await updatePurificationRegistration(id, input, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/purification");

  return NextResponse.json({ id: result.data.id });
}
