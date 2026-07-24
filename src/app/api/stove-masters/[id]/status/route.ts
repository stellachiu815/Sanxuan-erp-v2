import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { setStoveMasterStatus } from "@/lib/stoveMasters";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/** PATCH /api/stove-masters/xxx/status  body: { "status": "CANCELLED" } */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || (body.status !== "ACTIVE" && body.status !== "CANCELLED")) {
    return NextResponse.json({ error: "請提供正確的狀態" }, { status: 400 });
  }
  const __op = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "manageStoveMaster");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const result = await setStoveMasterStatus(id, body.status, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
