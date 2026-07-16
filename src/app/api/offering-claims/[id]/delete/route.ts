import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { moveOfferingClaimToRecycleBin } from "@/lib/offeringClaims";

/**
 * POST /api/offering-claims/xxx/delete
 * 需求「二十」：不得直接永久刪除，只能先移入回收區（只有已取消或已完成
 * 退款/轉款的認捐才能移入），30 天後才可能永久刪除（見 recycleBin.ts）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const operatorName = typeof body?.operatorName === "string" ? body.operatorName : null;

  const result = await moveOfferingClaimToRecycleBin(id, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  revalidatePath("/offering-center");
  revalidatePath("/system/recycle-bin");
  return NextResponse.json({ id: result.data.id });
}
