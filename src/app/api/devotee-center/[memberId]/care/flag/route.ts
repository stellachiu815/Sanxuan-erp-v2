import { NextRequest, NextResponse } from "next/server";
import { flagDevoteeForCare } from "@/lib/devoteeCare";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * POST /api/devotee-center/xxx/care/flag
 *   body: { operatorUserId, reason, assignedToName? }
 * 對應指令「十一」：由管理者決定是否正式標記需要關懷（manageCareList，
 * SUPER_ADMIN 專屬）。reason 必填——系統建議清單本身不能直接變成正式標記，
 * 管理者必須明確按下這個動作、並說明原因。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.reason !== "string" || !body.reason.trim()) {
    return NextResponse.json({ error: "請說明需要關懷的原因" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "manageCareList");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const profile = await flagDevoteeForCare(
    memberId,
    body.reason,
    typeof body.assignedToName === "string" ? body.assignedToName : null,
    check.operator.name
  );
  return NextResponse.json({ profile });
}
