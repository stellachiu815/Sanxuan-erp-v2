import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { previewMemberTransfer, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十三、成員轉移」。
 * POST /api/households/members/transfer/preview
 * body: { operatorUserId, memberIds: string[], targetHouseholdId }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (!Array.isArray(body.memberIds) || typeof body.targetHouseholdId !== "string") {
      return NextResponse.json({ success: false, error: "請選擇要轉移的成員與目標家戶" }, { status: 400 });
    }

    const preview = await previewMemberTransfer(
      body.memberIds.filter((id: unknown) => typeof id === "string"),
      body.targetHouseholdId
    );
    return NextResponse.json({ success: true, data: preview });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
