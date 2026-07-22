import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { listActivityGroups } from "@/lib/registrationItems";
import { canAcceptRegistration } from "@/lib/activityYear";

/**
 * V14：信眾詳情頁「新增活動報名」的資料來源（兩段式：先選主活動 → 再選項目）。
 *
 * GET /api/devotee-center/[memberId]/activity-groups?operatorUserId=xxx
 *
 * 回傳：
 *  - groups：所有主活動（普渡／年度燈／宮慶／補褲／龍鳳燈）與其報名項目（動態，不寫死）
 *  - openYearsByActivityType：每種 activityType 目前可報名的年度（來自 TempleEvent）
 *  - householdMembers：同家戶成員（供勾選本次納入者）
 *
 * ⚠️ 不再有「尚未設定報名表所以不能按」的死路：項目來自 RegistrationItemType，
 * 只要該項目的 activityType 有開放中的年度活動即可報名。
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

  const [groups, events] = await Promise.all([
    listActivityGroups(),
    prisma.templeEvent.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        activityType: true,
        year: true,
        name: true,
        registrationStartAt: true,
        registrationEndAt: true,
        isRegistrationOpen: true,
        isPrintOpen: true,
        isCompleted: true,
        isArchived: true,
        solarDate: true,
        status: true,
      },
      orderBy: [{ year: "desc" }, { activityType: "asc" }],
    }),
  ]);

  const now = new Date();
  const openYearsByActivityType: Record<string, { year: number; templeEventId: string; name: string }[]> = {};
  for (const e of events) {
    const acceptable = canAcceptRegistration(
      {
        templeEventId: e.id,
        activityType: e.activityType,
        year: e.year,
        name: e.name,
        registrationStartAt: e.registrationStartAt,
        registrationEndAt: e.registrationEndAt,
        eventDate: e.solarDate,
        isRegistrationOpen: e.isRegistrationOpen,
        isPrintOpen: e.isPrintOpen,
        isCompleted: e.isCompleted,
        isArchived: e.isArchived,
        status: e.status,
      },
      now
    );
    if (!acceptable.ok) continue;
    (openYearsByActivityType[e.activityType] ??= []).push({
      year: e.year,
      templeEventId: e.id,
      name: e.name,
    });
  }

  return NextResponse.json({
    ok: true,
    member: { id: member.id, name: member.name },
    household: { id: member.household.id, name: member.household.name },
    householdMembers: member.household.members,
    groups,
    openYearsByActivityType,
  });
}
