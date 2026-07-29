import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { archiveHousehold, previewHouseholdArchive, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V28：家戶封存前檢查。
 * GET /api/households/F00009/archive
 *   → { canArchive, blockers[], activeMemberCount, draftActivityCount, unpaidClaimCount, unpaidAmount, mergedFromCount }
 * 讓畫面在按下「封存家戶」前先顯示阻擋原因與處理入口。純讀取。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "archiveHousehold");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });
    const preview = await previewHouseholdArchive(id);
    return NextResponse.json({ success: true, data: preview });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}

/**
 * V12.1「家戶管理中心」指令「十四、空家戶處理」。
 * POST /api/households/F00009/archive  body: { operatorUserId, reason? }
 *
 * 封存沿用既有 Household.deletedAt／deletedByName（V8.0「刪除保護」），
 * 封存後的家戶會出現在既有回收區畫面，可用既有還原功能復原，不是永久
 * 刪除，也不是新的第二套封存機制。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "archiveHousehold");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;
    const { household } = await archiveHousehold(id, reason, check.operator.name);
    return NextResponse.json({ success: true, data: { household } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
