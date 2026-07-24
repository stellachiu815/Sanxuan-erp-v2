import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { previewHouseholdSplit, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十二、家戶拆分」。
 * POST /api/households/split/preview  body: { operatorUserId, householdId, memberIds: string[] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "splitHousehold");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (typeof body.householdId !== "string" || !Array.isArray(body.memberIds)) {
      return NextResponse.json({ success: false, error: "請選擇要拆分的家戶與移出成員" }, { status: 400 });
    }

    const preview = await previewHouseholdSplit(
      body.householdId,
      body.memberIds.filter((id: unknown) => typeof id === "string")
    );
    return NextResponse.json({ success: true, data: preview });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
