import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { listStoveMasterRegistrations, createStoveMasterRegistration } from "@/lib/stoveMasters";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V10.1「供品認捐中心」需求「十五、爐主與副爐主」。
 *
 * GET  /api/temple-events/xxx/stove-masters
 * POST /api/temple-events/xxx/stove-masters
 *   body: { "roleType": "STOVE_MASTER", "memberId": "xxx", ... } 或
 *         { "roleType": "VICE_STOVE_MASTER", "manualName": "王小明", "phone": "..." }
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const registrations = await listStoveMasterRegistrations(id);
  return NextResponse.json({ registrations });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || (body.roleType !== "STOVE_MASTER" && body.roleType !== "VICE_STOVE_MASTER")) {
    return NextResponse.json({ error: "請提供正確的身分類型（爐主／副爐主）" }, { status: 400 });
  }

  const __op = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageParticipants");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const operatorName = __op.operator.name;
  const result = await createStoveMasterRegistration(
    id,
    {
      roleType: body.roleType,
      memberId: typeof body.memberId === "string" ? body.memberId : null,
      householdId: typeof body.householdId === "string" ? body.householdId : null,
      manualName: typeof body.manualName === "string" ? body.manualName : null,
      phone: typeof body.phone === "string" ? body.phone : null,
      note: typeof body.note === "string" ? body.note : null,
    },
    operatorName
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/activities/${id}`);
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
