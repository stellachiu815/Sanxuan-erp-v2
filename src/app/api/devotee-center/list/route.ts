import { NextRequest, NextResponse } from "next/server";
import { listDevotees, type DevoteeListFilter } from "@/lib/devoteeList";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

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
 * GET /api/devotee-center/list?operatorUserId=xxx&q=王&filters=NEEDS_CARE,TAG_VIP&page=1&pageSize=20
 * 對應指令「五、信眾名單」：分頁 + 搜尋 + 篩選，全部在資料庫層級完成
 * （見 src/lib/devoteeList.ts）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const filtersRaw = searchParams.get("filters");
  const filters = filtersRaw
    ? filtersRaw
        .split(",")
        .map((f) => f.trim())
        .filter((f): f is DevoteeListFilter => VALID_FILTERS.includes(f as DevoteeListFilter))
    : undefined;

  const result = await listDevotees({
    q: searchParams.get("q") ?? undefined,
    filters,
    page: searchParams.get("page") ? Number(searchParams.get("page")) : undefined,
    pageSize: searchParams.get("pageSize") ? Number(searchParams.get("pageSize")) : undefined,
  });

  return NextResponse.json(result);
}
