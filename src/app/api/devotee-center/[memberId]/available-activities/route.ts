import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { listAvailableActivitiesForMember } from "@/lib/activityRegistration";

/**
 * V13.4：這位信眾目前可報名的活動清單。
 *
 * GET /api/devotee-center/[memberId]/available-activities?operatorUserId=xxx
 *
 * ⚠️ 活動清單**完全動態**——從 TempleEvent 查，用既有 canAcceptRegistration()
 * 過濾。前端零寫死年份與活動種類。
 *
 * 未設定 registrationFormType 的活動仍會列出，但標記 formSupported=false
 * 並附上原因，畫面顯示為不可報名（絕不自動降級成通用參加型）。
 *
 * 同時回傳同家戶成員清單，供畫面勾選本次納入的人。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { memberId } = await params;

  const member = await prisma.member.findFirst({
    where: { id: memberId, deletedAt: null },
    select: {
      id: true,
      name: true,
      householdId: true,
      household: {
        select: {
          id: true,
          name: true,
          members: {
            where: { deletedAt: null },
            select: { id: true, name: true, role: true, isDeceased: true },
            orderBy: { createdAt: "asc" },
          },
        },
      },
    },
  });
  if (!member) {
    return NextResponse.json({ error: "找不到這位信眾" }, { status: 404 });
  }

  const activities = await listAvailableActivitiesForMember(memberId);

  return NextResponse.json({
    ok: true,
    member: { id: member.id, name: member.name },
    household: { id: member.household.id, name: member.household.name },
    /** 同家戶成員，供勾選本次納入哪些人 */
    householdMembers: member.household.members,
    activities,
  });
}
