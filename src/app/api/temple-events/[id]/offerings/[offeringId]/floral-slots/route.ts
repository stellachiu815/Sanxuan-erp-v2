import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listFloralOfferingSlots, addFloralOfferingSlot } from "@/lib/activityOfferings";

/**
 * 需求「十」：花果供品年度排程。GET 回傳這個活動供品設定底下的全部名額
 * （通常是自動產生的 24 筆），POST 讓管理者手動新增額外日期（例如閏月調整）。
 */
export async function GET(_request: Request, { params }: { params: Promise<{ offeringId: string }> }) {
  const { offeringId } = await params;
  const slots = await listFloralOfferingSlots(offeringId);
  return NextResponse.json({ slots });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; offeringId: string }> }
) {
  const { id, offeringId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const result = await addFloralOfferingSlot(
    offeringId,
    Number(body.lunarMonth),
    Number(body.lunarDay),
    Boolean(body.isLeapMonth),
    typeof body.note === "string" ? body.note : null
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center/floral");
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
