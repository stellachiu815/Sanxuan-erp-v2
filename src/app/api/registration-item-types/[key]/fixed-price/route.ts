import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertActivityPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { getFixedItemPrice, setFixedItemPrice } from "@/lib/fixedItemPrice";

/**
 * 贊普型報名項目（補庫 STORAGE_TROUSERS／宮燈 PALACE_LANTERN）的固定單價。
 * GET   → 讀目前單價。
 * PATCH → 設定單價（feeMode=FIXED＋defaultUnitPrice）；只影響之後建立的報名。
 * 權限：讀＝活動 view；設定＝活動 manageSettings（同白米年度設定）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const check = await assertActivityPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { key } = await params;
  const res = await getFixedItemPrice(key);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, key: res.key, name: res.name, unitPrice: res.unitPrice });
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ key: string }> }) {
  const check = await assertActivityPermissionForOperator(await readOperatorUserId(request), "manageSettings");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  const unitPrice = Number((body as { unitPrice?: unknown })?.unitPrice);
  const { key } = await params;
  const res = await setFixedItemPrice(key, unitPrice);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, key: res.key, name: res.name, unitPrice: res.unitPrice, message: "已更新單價（只影響之後建立的報名，既有報名不變）。" });
}
