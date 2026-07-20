import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { transferHouseholdMembers, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十三、成員轉移」——正式執行轉移。
 * POST /api/households/members/transfer
 * body: {
 *   operatorUserId, memberIds: string[], targetHouseholdId,
 *   newHeadsForSourceHouseholds?: { [sourceHouseholdId]: memberId }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "transferMember");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (!Array.isArray(body.memberIds) || typeof body.targetHouseholdId !== "string") {
      return NextResponse.json({ success: false, error: "請選擇要轉移的成員與目標家戶" }, { status: 400 });
    }

    const newHeadsRaw =
      body.newHeadsForSourceHouseholds && typeof body.newHeadsForSourceHouseholds === "object"
        ? body.newHeadsForSourceHouseholds
        : {};
    const newHeadsForSourceHouseholds: Record<string, string> = {};
    for (const [key, value] of Object.entries(newHeadsRaw)) {
      if (typeof value === "string") newHeadsForSourceHouseholds[key] = value;
    }

    const result = await transferHouseholdMembers({
      memberIds: body.memberIds.filter((id: unknown) => typeof id === "string"),
      targetHouseholdId: body.targetHouseholdId,
      newHeadsForSourceHouseholds,
      // V12.3 指令三.3：各來源家戶的新主要聯絡人（未提供＝明確選擇暫不指定）。
      newPrimaryContactsForSourceHouseholds:
        (body.newPrimaryContactsForSourceHouseholds ?? undefined) as Record<string, string> | undefined,
      operatorName: check.operator.name,
      // V12.3 指令八：異動紀錄要能追到帳號，不只是自由文字姓名。
      operatorUserId: check.operator.id,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
