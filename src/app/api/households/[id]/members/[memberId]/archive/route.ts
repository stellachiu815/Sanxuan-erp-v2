import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { archiveMember, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V28：封存（軟刪除）單一家戶成員。不硬刪除信眾；成員仍保留 householdId，
 * 活動／付款／收據／列印／歷史紀錄都不變，之後可於封存區恢復。
 *
 * POST /api/households/F00009/members/<memberId>/archive
 *
 * 權限沿用 transferMember（結構性調整，SUPER_ADMIN／ADMIN）。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id: householdId, memberId } = await params;

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "transferMember");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const belongs = await prisma.member.findFirst({ where: { id: memberId, householdId }, select: { id: true } });
    if (!belongs) return NextResponse.json({ success: false, error: "找不到這位成員" }, { status: 404 });

    const { member } = await archiveMember(memberId, check.operator.name);
    revalidatePath(`/household/${householdId}`);
    return NextResponse.json({ success: true, data: { member } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
