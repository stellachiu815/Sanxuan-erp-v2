import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { assignHouseholdHead, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十、戶長設計」。
 * POST /api/households/F00009/head  body: { operatorUserId, memberId }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (typeof body.memberId !== "string" || !body.memberId) {
      return NextResponse.json({ success: false, error: "請選擇要指定為戶長的成員" }, { status: 400 });
    }

    const { member } = await assignHouseholdHead(id, body.memberId, check.operator.name);
    return NextResponse.json({ success: true, data: { member } });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
