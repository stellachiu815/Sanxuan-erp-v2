import { NextRequest, NextResponse } from "next/server";
import { unflagDevoteeCare } from "@/lib/devoteeCare";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * POST /api/devotee-center/xxx/care/unflag
 *   body: { operatorUserId }
 * 對應指令「十一」：取消正式關懷標記（manageCareList，SUPER_ADMIN 專屬）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => ({}));

  const check = await assertDevoteePermissionForOperator(body?.operatorUserId, "manageCareList");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const profile = await unflagDevoteeCare(memberId, check.operator.name);
  return NextResponse.json({ profile });
}
