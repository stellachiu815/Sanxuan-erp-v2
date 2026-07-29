import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { restoreMember, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V28：恢復已封存的家戶成員（原家戶須仍存在且未封存）。
 *
 * POST /api/households/F00009/members/<memberId>/restore
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: householdId, memberId } = await params;

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "transferMember");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const { member } = await restoreMember(memberId, check.operator.name);
    revalidatePath(`/household/${householdId}`);
    return NextResponse.json({ success: true, data: { member } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
