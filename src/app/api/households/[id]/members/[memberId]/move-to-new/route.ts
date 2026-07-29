import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { moveMemberToNewPersonalHousehold, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V28 孤兒防護「建立個人戶」：把一位成員移出到「新建的個人戶」。
 *
 * POST /api/households/F00009/members/<memberId>/move-to-new
 * body: { householdCode?, householdName? }  // 皆可省略，省略時自動配號、以「<姓名>（個人戶）」為戶名
 *
 * 沿用既有 createHousehold＋transferHouseholdMembers，不建立第二套搬移邏輯。
 * 「移至既有家戶」請改用既有 /api/households/members/transfer。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: householdId, memberId } = await params;

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "transferMember");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const belongs = await prisma.member.findFirst({ where: { id: memberId, householdId, deletedAt: null }, select: { id: true } });
    if (!belongs) return NextResponse.json({ success: false, error: "找不到這位成員" }, { status: 404 });

    const body = await request.json().catch(() => ({}));
    const { household } = await moveMemberToNewPersonalHousehold({
      memberId,
      householdCode: typeof body.householdCode === "string" ? body.householdCode : null,
      householdName: typeof body.householdName === "string" ? body.householdName : null,
      operatorName: check.operator.name,
      operatorUserId: await readOperatorUserId(request),
    });

    revalidatePath(`/household/${householdId}`);
    revalidatePath(`/household/${household.id}`);
    return NextResponse.json({ success: true, data: { household } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
