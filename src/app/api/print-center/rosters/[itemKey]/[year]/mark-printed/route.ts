import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { markRosterPrinted } from "@/lib/printDocuments";
import { checkRitualRecordsCompleteness, ritualRecordIdsForRoster } from "@/lib/completenessGate";

/**
 * V14：標記某項目某年度總名單為已列印（第一次列印或補印）。
 * POST /api/print-center/rosters/[itemKey]/[year]/mark-printed?operatorUserId=xxx
 *
 * ⚠️ 補印只增加 printCount，不改任何收款金額或狀態（指令八）。
 * 權限：manageParticipant（寫入；READONLY 一律 403）。
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ itemKey: string; year: string }> }
) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "manageParticipant"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { itemKey, year } = await params;
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }
  // V15R3：正式列印／補印總名單前套用資料完整度驗證（純讀取）。任一涵蓋報名不完整 →
  // 整批擋、回 422 結構化錯誤，markRosterPrinted 不執行，不寫 printedAt／不增加 printCount。
  const recordIds = await ritualRecordIdsForRoster(itemKey, yearNum);
  const completeness = await checkRitualRecordsCompleteness(recordIds);
  if (!completeness.allComplete) {
    return NextResponse.json(
      { code: "INCOMPLETE_DATA", message: "部分報名資料尚未完整，無法正式列印總名單", missingFields: completeness.missingFields, incompleteRecords: completeness.incompleteRecords },
      { status: 422 }
    );
  }

  const result = await markRosterPrinted(itemKey, yearNum);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, printed: result.printed });
}
