import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { registerRice } from "@/lib/whiteRiceService";
import type { Role } from "@/lib/whiteRice";

/**
 * V14.4 白米認購（正式建立）：沿用既有 RitualRegistrationItem（contentKind=RICE），
 * 鎖定當年度每斤金額；收款走既有應收/收款/帳本，不另建收款資料。
 *
 * POST /api/universal-salvation/115/rice
 * body: { ritualRecordId, memberId?, kg, overageReason? }
 *
 * 權限（指令七）：新增認購需 "create"；READONLY 無 create → 403。
 * 超額：STAFF 擋；ADMIN／SUPER_ADMIN 需填 overageReason 才可超額（記錄操作人/時間/原因）。
 * 操作人一律取自 session。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "create");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year } = await params;
  if (!Number.isInteger(Number(year))) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const body = await readJsonBody(request);
  const ritualRecordId = typeof body?.ritualRecordId === "string" ? body.ritualRecordId : "";
  if (!ritualRecordId) return NextResponse.json({ error: "缺少普渡登記 id（ritualRecordId）" }, { status: 400 });
  const kg = Number(body?.kg);
  if (!Number.isFinite(kg) || kg <= 0) return NextResponse.json({ error: "認購斤數必須大於 0" }, { status: 400 });

  const result = await registerRice(
    {
      ritualRecordId,
      memberId: typeof body?.memberId === "string" ? body.memberId : null,
      kg,
      overageReason: typeof body?.overageReason === "string" ? body.overageReason : null,
    },
    { role: check.operator.role as Role, userId: check.operator.id, name: check.operator.name }
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath("/rituals/universal-salvation");
  return NextResponse.json(
    { itemId: result.itemId, amountDue: result.amountDue, overage: result.overage },
    { status: 201 }
  );
}
