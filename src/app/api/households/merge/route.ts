import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import {
  mergeHouseholds,
  toHouseholdApiError,
  type HouseholdMergeFieldResolution,
} from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十一、家戶合併」——正式執行合併。
 * POST /api/households/merge
 * body: {
 *   operatorUserId, targetId, sourceId,
 *   fieldResolution?: { name?: {use:"target"|"source"|"custom", value?}, ... },
 *   keepHeadMemberId?: string
 * }
 *
 * 全部在 src/lib/householdManagement.ts 的 mergeHouseholds() 單一
 * Transaction 內完成：成員搬移、歷代祖先/乙位正魂去重合併、欄位衝突
 * 套用、來源家戶封存、寫入版本紀錄，任一步驟失敗全部回復。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (typeof body.targetId !== "string" || typeof body.sourceId !== "string") {
      return NextResponse.json({ success: false, error: "請選擇目標家戶與來源家戶" }, { status: 400 });
    }

    const result = await mergeHouseholds({
      targetId: body.targetId,
      sourceId: body.sourceId,
      fieldResolution: (body.fieldResolution ?? undefined) as HouseholdMergeFieldResolution | undefined,
      keepHeadMemberId: typeof body.keepHeadMemberId === "string" ? body.keepHeadMemberId : null,
      operatorName: check.operator.name,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
