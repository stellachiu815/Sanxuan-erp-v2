import { NextRequest, NextResponse } from "next/server";
import { updateDevoteeProfile } from "@/lib/devoteeProfile";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * PATCH /api/devotee-center/xxx/profile
 *   body: { operatorUserId, mobile?, lineId?, email?, companyName?, personalNote?,
 *           isDisabled?, disabledReason? }
 * 對應指令「七、信眾延伸資料」。SUPER_ADMIN／ADMIN 都可以呼叫（見
 * src/lib/permissions.ts DEVOTEE_PERMISSIONS 註解：本輪沒有把任何延伸資料
 * 欄位另外標記為「僅 SUPER_ADMIN 專屬」）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "updateProfile");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const profile = await updateDevoteeProfile(
    memberId,
    {
      mobile: body.mobile !== undefined ? (typeof body.mobile === "string" ? body.mobile : null) : undefined,
      lineId: body.lineId !== undefined ? (typeof body.lineId === "string" ? body.lineId : null) : undefined,
      email: body.email !== undefined ? (typeof body.email === "string" ? body.email : null) : undefined,
      companyName:
        body.companyName !== undefined ? (typeof body.companyName === "string" ? body.companyName : null) : undefined,
      personalNote:
        body.personalNote !== undefined ? (typeof body.personalNote === "string" ? body.personalNote : null) : undefined,
      isDisabled: typeof body.isDisabled === "boolean" ? body.isDisabled : undefined,
      disabledReason:
        body.disabledReason !== undefined ? (typeof body.disabledReason === "string" ? body.disabledReason : null) : undefined,
    },
    check.operator.name
  );

  return NextResponse.json({ profile });
}
