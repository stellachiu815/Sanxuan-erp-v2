import { NextRequest, NextResponse } from "next/server";
import { resetPrintObjectsToUnprinted } from "@/lib/resetPrintObjects";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * 「重設為未列印」：把選取的列印物件退回未列印（取消列印登記）。
 * POST /api/universal-salvation/115/print-items/reset  body: { ids: string[] }
 * 只動列印狀態、不動收款/內容。權限同列印（print）；READONLY → 403。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "print");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  await params; // year 僅用於路由一致性
  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "請至少選擇一筆要重設的項目" }, { status: 400 });

  const res = await resetPrintObjectsToUnprinted(ids, check.operator.name);
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json({ ok: true, reset: res.reset });
}
