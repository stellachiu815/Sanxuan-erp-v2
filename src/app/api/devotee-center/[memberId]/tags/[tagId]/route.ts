import { NextRequest, NextResponse } from "next/server";
import { removeDevoteeTag } from "@/lib/devoteeTags";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * DELETE /api/devotee-center/xxx/tags/yyy?operatorUserId=xxx
 * 對應指令「八」：移除信眾身上的標籤（applyTag，SUPER_ADMIN + ADMIN）。
 * 這裡「移除套用關係」不等於「刪除標籤定義」——標籤定義本身的停用走
 * PATCH /api/devotee-center/tags/[tagId]。
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ memberId: string; tagId: string }> }) {
  const { memberId, tagId } = await params;
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "applyTag");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  await removeDevoteeTag(memberId, tagId, check.operator.name);
  return NextResponse.json({ ok: true });
}
