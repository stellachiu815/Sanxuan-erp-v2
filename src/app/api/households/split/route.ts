import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { splitHousehold, toHouseholdApiError, type WorshipHandling } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十二、家戶拆分」——正式執行拆分。
 * POST /api/households/split
 * body: {
 *   operatorUserId, householdId, memberIds: string[],
 *   newHousehold: { householdCode, householdName, primaryContact, address, phone, mobile, notes },
 *   newHeadMemberId?, originalNewHeadMemberId?,
 *   ancestorHandling?: { [worshipRecordId]: "KEEP"|"MOVE"|"COPY" }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(body.operatorUserId, "updateProfile");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (typeof body.householdId !== "string" || !Array.isArray(body.memberIds)) {
      return NextResponse.json({ success: false, error: "請選擇要拆分的家戶與移出成員" }, { status: 400 });
    }
    const newHousehold = body.newHousehold && typeof body.newHousehold === "object" ? body.newHousehold : {};

    const ancestorHandlingRaw =
      body.ancestorHandling && typeof body.ancestorHandling === "object" ? body.ancestorHandling : {};
    const ancestorHandling: Record<string, WorshipHandling> = {};
    for (const [key, value] of Object.entries(ancestorHandlingRaw)) {
      if (value === "KEEP" || value === "MOVE" || value === "COPY") ancestorHandling[key] = value;
    }

    const result = await splitHousehold({
      householdId: body.householdId,
      memberIdsToMove: body.memberIds.filter((id: unknown) => typeof id === "string"),
      newHousehold: {
        id: typeof newHousehold.householdCode === "string" ? newHousehold.householdCode : undefined,
        name: typeof newHousehold.householdName === "string" ? newHousehold.householdName : undefined,
        contactName: newHousehold.primaryContact,
        address: newHousehold.address,
        phone: newHousehold.phone,
        mobile: newHousehold.mobile,
        notes: newHousehold.notes,
      },
      newHeadMemberId: typeof body.newHeadMemberId === "string" ? body.newHeadMemberId : null,
      originalNewHeadMemberId:
        typeof body.originalNewHeadMemberId === "string" ? body.originalNewHeadMemberId : null,
      ancestorHandling,
      operatorName: check.operator.name,
    });

    return NextResponse.json({ success: true, data: result });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
