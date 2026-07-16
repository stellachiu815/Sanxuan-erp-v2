import { NextRequest, NextResponse } from "next/server";
import { listPrintItemsForPrintCenter, type PrintCenterFilters } from "@/lib/additionalPrintItems";
import type { AdditionalPrintItemStatusValue } from "@/lib/additionalPrintItemRules";

const VALID_STATUSES: AdditionalPrintItemStatusValue[] = [
  "PENDING_CONFIRMATION",
  "PENDING_PRINT",
  "PRINTED",
  "CANCELLED",
];

/**
 * 普渡列印中心（需求「九」）：跨家戶查詢這一年度所有附加列印項目，可依
 * 活動/家戶/報名人/原祭祀類型/原祭祀名稱/寶袋列印名稱/預設額外/待列印
 * 已列印篩選。
 *
 * GET /api/universal-salvation/115/print-items
 *   ?activityId=xxx&householdId=F00009&registrantName=王&sourceCategory=ANCESTOR_LINE
 *   &sourceName=王姓歷代祖先&printName=王&isExtra=true&status=PENDING_PRINT
 * （全部都是選填的篩選條件，可以自由組合）
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const { year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;

  const filters: PrintCenterFilters = {};
  const activityId = searchParams.get("activityId");
  if (activityId) filters.activityId = activityId;
  const householdId = searchParams.get("householdId");
  if (householdId) filters.householdId = householdId;
  const registrantName = searchParams.get("registrantName");
  if (registrantName) filters.registrantName = registrantName;
  const sourceCategory = searchParams.get("sourceCategory");
  if (sourceCategory) filters.sourceCategory = sourceCategory;
  const sourceName = searchParams.get("sourceName");
  if (sourceName) filters.sourceName = sourceName;
  const printName = searchParams.get("printName");
  if (printName) filters.printName = printName;
  const isExtra = searchParams.get("isExtra");
  if (isExtra === "true") filters.isExtra = true;
  else if (isExtra === "false") filters.isExtra = false;
  const status = searchParams.get("status");
  if (status && (VALID_STATUSES as string[]).includes(status)) {
    filters.status = status as AdditionalPrintItemStatusValue;
  }

  const items = await listPrintItemsForPrintCenter(year, filters);

  return NextResponse.json({ items });
}
