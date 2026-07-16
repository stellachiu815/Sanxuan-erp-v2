import { NextRequest, NextResponse } from "next/server";
import { getDevoteeTagsForMember, applyDevoteeTag } from "@/lib/devoteeTags";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/xxx/tags?operatorUserId=xxx — 這位信眾目前的標籤清單。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const tags = await getDevoteeTagsForMember(memberId);
  return NextResponse.json({ tags });
}

/**
 * POST /api/devotee-center/xxx/tags
 *   body: { operatorUserId, tagId }
 * 對應指令「八」：套用既有標籤到信眾身上（SUPER_ADMIN + ADMIN，applyTag）。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ memberId: string }> }) {
  const { memberId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.tagId !== "string") {
    return NextResponse.json({ error: "請提供 tagId" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "applyTag");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const assignment = await applyDevoteeTag(memberId, body.tagId, check.operator.name);
    return NextResponse.json({ assignment }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "套用標籤失敗" }, { status: 400 });
  }
}
