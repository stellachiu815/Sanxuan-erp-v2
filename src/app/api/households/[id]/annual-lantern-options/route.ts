import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listActivityGroups } from "@/lib/registrationItems";
import { canAcceptRegistration } from "@/lib/activityYear";

/**
 * V15R4 年度燈統一：全戶多人多項目報名 picker 的資料來源（家戶入口）。
 *
 * GET /api/households/[id]/annual-lantern-options?operatorUserId=xxx
 *
 * 回傳單一「年度燈」主活動（activityGroup=ANNUAL_LANTERN）底下的四個 RegistrationItemType
 * （光明燈／太歲燈／全家燈／祭改）、全戶成員、目前開放中的年度燈年度。三個入口
 * （信眾詳情／家戶詳情／年度燈活動管理）共用同一份資料與同一 /api/registrations/batch。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const household = await prisma.household.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      name: true,
      address: true,
      members: {
        where: { deletedAt: null },
        select: { id: true, name: true, role: true, isDeceased: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!household) return NextResponse.json({ error: "找不到這個家戶" }, { status: 404 });

  const [groups, events] = await Promise.all([
    listActivityGroups(),
    prisma.templeEvent.findMany({
      where: { activityType: "ANNUAL_LANTERN", isArchived: false },
      select: {
        id: true, activityType: true, year: true, name: true,
        registrationStartAt: true, registrationEndAt: true, isRegistrationOpen: true,
        isPrintOpen: true, isCompleted: true, isArchived: true, solarDate: true, status: true,
      },
      orderBy: { year: "desc" },
    }),
  ]);

  const lanternGroup = groups.find((g) => g.activityGroup === "ANNUAL_LANTERN") ?? null;

  const now = new Date();
  const openYears: { year: number; templeEventId: string; name: string }[] = [];
  for (const e of events) {
    const acceptable = canAcceptRegistration(
      {
        templeEventId: e.id, activityType: e.activityType, year: e.year, name: e.name,
        registrationStartAt: e.registrationStartAt, registrationEndAt: e.registrationEndAt,
        eventDate: e.solarDate, isRegistrationOpen: e.isRegistrationOpen, isPrintOpen: e.isPrintOpen,
        isCompleted: e.isCompleted, isArchived: e.isArchived, status: e.status,
      },
      now
    );
    if (acceptable.ok) openYears.push({ year: e.year, templeEventId: e.id, name: e.name });
  }

  return NextResponse.json({
    ok: true,
    household: { id: household.id, name: household.name, address: household.address },
    members: household.members,
    lanternGroup,
    openYears,
  });
}
