import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { saveWorkOrders } from "@/lib/workOrderRepo";
import { listAnnualLanternWorkOrderRows, isAnnualLanternLampKey } from "@/lib/annualLanternWorkOrder";

/**
 * V41 年度燈「正式作業編號」管理 API（照燈別）。
 * GET  /api/print-center/annual-lantern-work-orders/[year]?lampKey=LANTERN_GUANGMING → { rows }
 * POST body: { lampKey, updates:[{id,workOrder|null}] } → 存 workOrder（沿用通用 saveWorkOrders：
 *   兩階段存檔、(templeEventId,registrationItemTypeId,workOrder) 唯一約束、重號整批 rollback）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yp } = await params;
  const year = Number(yp);
  const lampKey = request.nextUrl.searchParams.get("lampKey") ?? "";
  if (!Number.isInteger(year)) return NextResponse.json({ error: "缺少年度" }, { status: 400 });
  if (!isAnnualLanternLampKey(lampKey)) return NextResponse.json({ error: "燈別不正確" }, { status: 400 });
  const rows = await listAnnualLanternWorkOrderRows(year, lampKey);
  return NextResponse.json({ ok: true, rows });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const { year: yp } = await params;
  const year = Number(yp);
  const body = await readJsonBody(request);
  if (!body) return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  const lampKey = typeof body.lampKey === "string" ? body.lampKey : "";
  if (!Number.isInteger(year)) return NextResponse.json({ error: "缺少年度" }, { status: 400 });
  if (!isAnnualLanternLampKey(lampKey)) return NextResponse.json({ error: "燈別不正確" }, { status: 400 });

  const updates = Array.isArray(body.updates)
    ? body.updates.filter((u: unknown): u is { id: string; workOrder: number | null } => !!u && typeof (u as { id?: unknown }).id === "string")
    : [];
  if (updates.length > 0) {
    const res = await saveWorkOrders(updates);
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  }
  const rows = await listAnnualLanternWorkOrderRows(year, lampKey);
  return NextResponse.json({ ok: true, rows });
}
