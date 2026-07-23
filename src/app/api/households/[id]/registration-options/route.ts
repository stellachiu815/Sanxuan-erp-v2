import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { getHouseholdRegistrationOptions } from "@/lib/householdRegistrationOptions";

/**
 * V14.2：中元普渡報名的「本戶固定選項」。
 *
 * GET /api/households/[id]/registration-options?operatorUserId=xxx
 *   → { ok, ancestorNames: string[], yangshangNames: string[] }
 *
 * ancestorNames＝本戶歷代祖先牌位名稱（供歷代祖先新增區塊一鍵帶入）。
 * yangshangNames＝本戶固定陽上人候選（字庫＋戶主＋主要聯絡人＋成員）。
 * 純讀取；權限沿用普渡權限。
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
  const options = await getHouseholdRegistrationOptions(id);
  return NextResponse.json({ ok: true, ...options });
}
