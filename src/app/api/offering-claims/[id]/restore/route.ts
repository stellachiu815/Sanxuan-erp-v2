import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { restoreOfferingClaim } from "@/lib/offeringClaims";

/** POST /api/offering-claims/xxx/restore：把「已取消」的認捐恢復為有效狀態（不是回收區還原，見 recycleBin.ts 的區別說明）。 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const operatorName = typeof body?.operatorName === "string" ? body.operatorName : null;

  const result = await restoreOfferingClaim(id, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  return NextResponse.json({ id: result.data.id });
}
