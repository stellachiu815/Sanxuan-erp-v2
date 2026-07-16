import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { issueReceipt } from "@/lib/receipt";
import { assertReceiptPermissionForOperator } from "@/lib/operator";

/**
 * POST /api/receipt-center/issue
 *   body: { operatorUserId, lines: [{allocationId, amount, itemName?}], receiptType?,
 *           receiptDate?, payerName?, note?, idempotencyKey? }
 * 需求「五、收據開立方式」：合併開立（lines 多筆）／分項開立（lines 一筆，
 * 前端對同一筆收款重複呼叫數次）。
 *
 * V11.1.1 新增：body.operatorUserId 必填，伺服器端真的驗證「開立收據」
 * 權限，未通過回傳 401/403 並拒絕執行；開立人姓名一律採用驗證過的真實
 * 姓名（不再信任 createdByName 這個自由文字欄位）。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.lines) || !body.lines.length) {
    return NextResponse.json({ error: "請至少選擇一筆收款分配項目" }, { status: 400 });
  }
  for (const line of body.lines) {
    if (typeof line.allocationId !== "string" || typeof line.amount !== "number") {
      return NextResponse.json({ error: "每一筆項目都需要 allocationId 與 amount" }, { status: 400 });
    }
  }

  const check = await assertReceiptPermissionForOperator(body.operatorUserId, "issue");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await issueReceipt(
    {
      lines: body.lines.map((l: { allocationId: string; amount: number; itemName?: string }) => ({
        allocationId: l.allocationId,
        amount: l.amount,
        itemName: typeof l.itemName === "string" ? l.itemName : undefined,
      })),
      receiptType: body.receiptType === "SPLIT_ITEM" ? "SPLIT_ITEM" : "MERGED",
      receiptDate: body.receiptDate ? new Date(body.receiptDate) : undefined,
      payerName: typeof body.payerName === "string" ? body.payerName : undefined,
      note: typeof body.note === "string" ? body.note : undefined,
      idempotencyKey: typeof body.idempotencyKey === "string" ? body.idempotencyKey : null,
      createdByName: check.operator.name,
    },
    check.operator.name
  );
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  revalidatePath("/receipt-center");
  revalidatePath("/collection-center");
  return NextResponse.json(result.data, { status: 201 });
}
