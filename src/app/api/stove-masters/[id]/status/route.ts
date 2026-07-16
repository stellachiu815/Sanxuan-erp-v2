import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { setStoveMasterStatus } from "@/lib/stoveMasters";

/** PATCH /api/stove-masters/xxx/status  body: { "status": "CANCELLED" } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.status !== "ACTIVE" && body.status !== "CANCELLED")) {
    return NextResponse.json({ error: "請提供正確的狀態" }, { status: 400 });
  }
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;
  const result = await setStoveMasterStatus(id, body.status, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
