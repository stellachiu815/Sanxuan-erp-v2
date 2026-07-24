import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createManualReceivable } from "@/lib/collectionCenter";
import { assertCollectionPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/collection-center/manual-receivables
 *   body: { title, year, payerMemberId?, payerHouseholdId?, payerNameSnapshot,
 *           payerPhoneSnapshot?, amountDue, note?, createdByName? }
 * 收款中心自建的「其他臨時應收項目」——不是另一個宮務模組，只服務收款這件事。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || typeof body.title !== "string" || typeof body.amountDue !== "number") {
    return NextResponse.json({ error: "請提供項目名稱與應收金額" }, { status: 400 });
  }
  if (typeof body.payerNameSnapshot !== "string" || !body.payerNameSnapshot.trim()) {
    return NextResponse.json({ error: "請提供付款人姓名" }, { status: 400 });
  }
  if (typeof body.year !== "number") {
    return NextResponse.json({ error: "請提供年度" }, { status: 400 });
  }
  // V14.3：建立臨時應收（收款前置），STAFF 以上可；操作人用登入 session。
  const check = await assertCollectionPermissionForOperator(await readOperatorUserId(request), "manageManualReceivable");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await createManualReceivable({
    title: body.title,
    year: body.year,
    payerMemberId: typeof body.payerMemberId === "string" ? body.payerMemberId : null,
    payerHouseholdId: typeof body.payerHouseholdId === "string" ? body.payerHouseholdId : null,
    payerNameSnapshot: body.payerNameSnapshot,
    payerPhoneSnapshot: typeof body.payerPhoneSnapshot === "string" ? body.payerPhoneSnapshot : null,
    amountDue: body.amountDue,
    note: typeof body.note === "string" ? body.note : null,
    createdByName: check.operator.name,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  revalidatePath("/collection-center");
  return NextResponse.json(result.data, { status: 201 });
}
