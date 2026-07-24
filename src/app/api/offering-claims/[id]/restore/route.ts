import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { restoreOfferingClaim } from "@/lib/offeringClaims";
import { assertOfferingPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/** POST /api/offering-claims/xxx/restore：把「已取消」的認捐恢復為有效狀態（不是回收區還原，見 recycleBin.ts 的區別說明）。 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await request.json().catch(() => ({}));
  // V14.3：恢復認捐屬管理操作，僅 SUPER_ADMIN／ADMIN；操作人以登入 session 為準。
  const check = await assertOfferingPermissionForOperator(await readOperatorUserId(request), "cancelClaim");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await restoreOfferingClaim(id, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
