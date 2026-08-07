import { NextRequest, NextResponse } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { addMasterOffering, listMasterOfferings, setMasterOfferingPaid, updateMasterOffering, deleteMasterOffering } from "@/lib/masterOffering";

/**
 * V38 供師活動 API（**不進財務流程**）。
 *  GET  ?year=115            → 名單＋合計金額＋已繳筆數
 *  POST { year, name, amount, householdId?, memberId? } → 新增
 *  PATCH { id, paid? , name?, amount? } → 勾繳費／改姓名金額
 *  DELETE { id }            → 軟刪除
 * 權限＝ritual registration「register」（報名流程的一步）。
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear() - 1911;
  const data = await listMasterOfferings(year);
  return NextResponse.json({ ok: true, year, ...data });
}

export async function POST(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  const year = Number(body?.year) || new Date().getFullYear() - 1911;
  const res = await addMasterOffering({
    year,
    name: typeof body?.name === "string" ? body.name : "",
    amount: Number(body?.amount) || 0,
    householdId: typeof body?.householdId === "string" ? body.householdId : null,
    memberId: typeof body?.memberId === "string" ? body.memberId : null,
    paid: body?.paid === true,
    operatorName: check.operator.name,
  });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, id: res.id }, { status: 201 });
}

export async function PATCH(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "缺少供師 id" }, { status: 400 });
  if (typeof body?.paid === "boolean") {
    await setMasterOfferingPaid(id, body.paid);
    return NextResponse.json({ ok: true });
  }
  const res = await updateMasterOffering(id, { name: typeof body?.name === "string" ? body.name : undefined, amount: body?.amount !== undefined ? Number(body.amount) : undefined });
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });
  const body = await readJsonBody(request);
  const id = typeof body?.id === "string" ? body.id : "";
  if (!id) return NextResponse.json({ error: "缺少供師 id" }, { status: 400 });
  await deleteMasterOffering(id, check.operator.name);
  return NextResponse.json({ ok: true });
}
