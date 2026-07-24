import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { registerItem } from "@/lib/registrationItemRegistration";

/**
 * V14：從信眾詳情頁報名一個具體項目。
 *
 * POST /api/devotee-center/[memberId]/registration-items?operatorUserId=xxx
 * body: { registrationItemTypeId, year, participantMemberIds?, quantity?,
 *         customName?, customAmount?, feeChoice? }
 *
 * 權限：register（READONLY 一律 403）。operatorUserId 由後端驗證，不信任前端姓名。
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "register");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { memberId } = await params;
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "請求內容格式錯誤" }, { status: 400 });
  }

  const registrationItemTypeId = body.registrationItemTypeId;
  const year = body.year;
  if (typeof registrationItemTypeId !== "string" || typeof year !== "number") {
    return NextResponse.json({ error: "缺少必要欄位：registrationItemTypeId 或 year" }, { status: 400 });
  }

  const result = await registerItem({
    registrationItemTypeId,
    year,
    memberId,
    participantMemberIds: Array.isArray(body.participantMemberIds)
      ? (body.participantMemberIds as unknown[]).filter((x): x is string => typeof x === "string")
      : undefined,
    quantity: typeof body.quantity === "number" ? body.quantity : undefined,
    customName: typeof body.customName === "string" ? body.customName : null,
    customAmount: typeof body.customAmount === "number" ? body.customAmount : null,
    feeChoice: body.feeChoice === "FIXED" || body.feeChoice === "CUSTOM" ? body.feeChoice : null,
    operatorName: check.operator.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({
    ok: true,
    ritualRecordId: result.ritualRecordId,
    registrationItemId: result.registrationItemId,
    amountDue: result.amountDue,
    editorUrl: `/registration/${result.ritualRecordId}`,
  });
}
