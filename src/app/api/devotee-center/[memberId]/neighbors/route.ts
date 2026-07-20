import { NextRequest, NextResponse } from "next/server";
import { getAdjacentDevoteeIds, type DevoteeListFilter } from "@/lib/devoteeList";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

const VALID_FILTERS: DevoteeListFilter[] = [
  "ACTIVE",
  "DISABLED",
  "DECEASED",
  "HAS_PHONE",
  "NO_PHONE",
  "HAS_ADDRESS",
  "NO_ADDRESS",
  "BIRTHDAY_THIS_MONTH",
  "ACTIVE_THIS_YEAR",
  "INACTIVE_OVER_1YEAR",
  "NEEDS_CARE",
  "TAG_VIP",
  "TAG_VOLUNTEER",
  "TAG_COMMITTEE",
  "NO_BIRTHDAY",
  "DATA_COMPLETE",
];

/**
 * GET /api/devotee-center/xxx/neighbors?operatorUserId=xxx&q=王&filters=NO_ADDRESS
 *
 * 對應指令「七、上一位／下一位」。q／filters 帶入跟目前信眾名單頁完全相同
 * 的參數，讓上一位/下一位維持在同一個篩選範圍內，見 src/lib/devoteeList.ts
 * getAdjacentDevoteeIds() 的說明。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const filtersRaw = searchParams.get("filters");
  const filters = filtersRaw
    ? filtersRaw
        .split(",")
        .map((f) => f.trim())
        .filter((f): f is DevoteeListFilter => VALID_FILTERS.includes(f as DevoteeListFilter))
    : undefined;

  const result = await getAdjacentDevoteeIds(memberId, { q: searchParams.get("q") ?? undefined, filters });
  return NextResponse.json(result);
}
