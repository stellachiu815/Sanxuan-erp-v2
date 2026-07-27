import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listActivityGroups } from "@/lib/registrationItems";
import { canAcceptRegistration } from "@/lib/activityYear";

/**
 * V15R6：家戶「多人 × 多項目」普渡合併報名 picker 的資料來源（純讀取）。
 *
 * GET /api/households/[id]/universal-salvation-batch-options?year=115
 *
 * 回傳（送出仍走既有 /api/registrations/batch，不建第二套報名架構）：
 *  - household / members：整戶成員（同一畫面逐位勾選）
 *  - items：中元普渡（UNIVERSAL_SALVATION）底下所有報名項目（動態、不寫死）
 *  - openYears：目前可報名的普渡年度
 *  - year：本次採用年度（帶入 query 或預設最新開放年度／本年度）
 *  - existingByMemberItem：`<memberId>::<itemKey>` → { count } 既有未取消草稿，供標示「已報名」
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id: householdId } = await params;
  const household = await prisma.household.findFirst({
    where: { id: householdId, deletedAt: null },
    select: {
      id: true,
      name: true,
      members: {
        where: { deletedAt: null },
        select: { id: true, name: true, role: true, isDeceased: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!household) return NextResponse.json({ error: "找不到這一戶" }, { status: 404 });

  const [groups, events] = await Promise.all([
    listActivityGroups(),
    prisma.templeEvent.findMany({
      where: { isArchived: false, activityType: "UNIVERSAL_SALVATION" },
      select: {
        id: true, activityType: true, year: true, name: true,
        registrationStartAt: true, registrationEndAt: true,
        isRegistrationOpen: true, isPrintOpen: true, isCompleted: true, isArchived: true,
        solarDate: true, status: true,
      },
      orderBy: [{ year: "desc" }],
    }),
  ]);

  // 中元普渡底下所有項目（依 activityType 過濾，動態）。
  const items = groups
    .flatMap((g) => g.items)
    .filter((it) => it.activityType === "UNIVERSAL_SALVATION");

  const now = new Date();
  const openYears: number[] = [];
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
    if (acceptable.ok) openYears.push(e.year);
  }
  openYears.sort((a, b) => b - a);

  const currentRocYear = now.getFullYear() - 1911;
  const requestedYear = Number(request.nextUrl.searchParams.get("year"));
  const year = Number.isInteger(requestedYear)
    ? requestedYear
    : openYears.length > 0
      ? openYears[0]
      : currentRocYear;

  // 該年度、本戶已存在（未取消未刪除）的普渡項目 → 標示「已報名」，避免重複建立。
  const existingItems = await prisma.ritualRegistrationItem.findMany({
    where: {
      deletedAt: null,
      status: { not: "CANCELLED" },
      memberId: { not: null },
      ritualRecord: { householdId, year, activityType: "UNIVERSAL_SALVATION", deletedAt: null },
    },
    select: { memberId: true, registrationItemType: { select: { key: true } } },
  });
  const existingByMemberItem: Record<string, number> = {};
  for (const it of existingItems) {
    if (!it.memberId) continue;
    const k = `${it.memberId}::${it.registrationItemType.key}`;
    existingByMemberItem[k] = (existingByMemberItem[k] ?? 0) + 1;
  }

  return NextResponse.json({
    ok: true,
    household: { id: household.id, name: household.name },
    members: household.members,
    items,
    openYears,
    year,
    existingByMemberItem,
  });
}
