import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { listArchivedWorshipRecords } from "@/lib/worshipRecordManagement";

/**
 * V28：家戶「祭祀永久資料封存區」清單。
 *
 * GET /api/households/F00009/worship/archived
 *   → 已封存的歷代祖先／乙位正魂（可查詢、可恢復）。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: householdId } = await params;

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

  const records = await listArchivedWorshipRecords(householdId);
  return NextResponse.json({ success: true, data: { records } });
}
