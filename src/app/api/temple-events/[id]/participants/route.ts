import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { addGenericParticipant, listGenericParticipants } from "@/lib/templeEvents";

/**
 * 通用參加名單（光明燈/太歲燈/全家燈/補庫/宮慶/其他——目前還沒有專屬明細
 * 規格，先用最基本的「一戶一筆＋備註」，見 src/lib/templeEvents.ts 說明）。
 *
 * GET  /api/temple-events/xxx/participants
 * POST /api/temple-events/xxx/participants
 *   body: { "householdId": "F00009", "notes": "備註", "operatorName": "操作人姓名" }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const participants = await listGenericParticipants(id);
  return NextResponse.json({ participants });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.householdId !== "string" || !body.householdId.trim()) {
    return NextResponse.json({ error: "請選擇家戶" }, { status: 400 });
  }

  const result = await addGenericParticipant(
    id,
    body.householdId.trim(),
    typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    typeof body.operatorName === "string" ? body.operatorName : null
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);

  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
