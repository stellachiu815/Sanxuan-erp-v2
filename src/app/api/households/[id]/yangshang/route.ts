import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { listHouseholdYangshang, addHouseholdYangshang } from "@/lib/householdYangshang";

/**
 * V14.2：本戶固定陽上人名單。
 *
 * GET  /api/households/[id]/yangshang?operatorUserId=xxx  → { ok, names: string[] }
 * POST /api/households/[id]/yangshang  { operatorUserId, name } → { ok, names }
 *
 * 權限沿用普渡權限（建牌位流程的一部分）；operatorName 一律伺服器查證。
 * 去重與空白處理在 service，端點只做權限與輸入檢查。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { id } = await params;
  const names = await listHouseholdYangshang(id);
  return NextResponse.json({ ok: true, names });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "update");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }
  const name = typeof body.name === "string" ? body.name : "";

  const { id } = await params;
  const result = await addHouseholdYangshang(id, name, "MANUAL");
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  return NextResponse.json({ ok: true, names: result.names });
}
