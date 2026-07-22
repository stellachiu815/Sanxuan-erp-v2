import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { markRosterPrinted } from "@/lib/printDocuments";

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
  const check = await assertRitualRegistrationPermissionForOperator(
    new URL(request.url).searchParams.get("operatorUserId"),
    "manageParticipant"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { itemKey, year } = await params;
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }
  const result = await markRosterPrinted(itemKey, yearNum);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true, printed: result.printed });
}
