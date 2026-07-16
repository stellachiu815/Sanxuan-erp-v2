import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { printReceipt } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * POST /api/receipt-center/receipts/xxx/print
 *   body: { operatorUserId, reason?, deviceInfo? }
 * 需求「九、收據列印」「十、補印功能」：第一次列印記錄為 ORIGINAL_PRINT，
 * 之後每一次都是 REPRINT（由伺服器依 printCount 判斷，不信任前端傳入的種類）。
 *
 * V11.1.1 新增：body.operatorUserId 必填，伺服器端驗證「列印」權限（目前
 * 權限矩陣裡 print／reprint 對所有角色的開放範圍完全相同，這裡先以
 * print 作為統一檢查依據；若之後兩者權限分開，需要在這裡依
 * printReceipt() 判斷出的種類分別檢查）。列印人姓名一律採用驗證過的
 * 真實姓名。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const check = await assertReceiptPermissionForOperator(body.operatorUserId, "print");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await printReceipt(id, {
    printedByName: check.operator.name,
    reason: typeof body.reason === "string" ? body.reason : undefined,
    deviceInfo: typeof body.deviceInfo === "string" ? body.deviceInfo : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  return NextResponse.json(result.data);
}
