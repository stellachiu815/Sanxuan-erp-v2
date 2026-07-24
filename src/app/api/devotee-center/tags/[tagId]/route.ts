import { NextRequest, NextResponse } from "next/server";
import { renameDevoteeTag, setDevoteeTagActive } from "@/lib/devoteeTags";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * PATCH /api/devotee-center/tags/xxx
 *   body: { operatorUserId, name?, isActive? }
 * 對應指令「八」：修改標籤名稱／停用（停用＝「刪除」的實際行為，見
 * src/lib/devoteeTags.ts 說明）。SUPER_ADMIN 專屬（manageTags）。
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ tagId: string }> }) {
  const { tagId } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "manageTags");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    let tag;
    if (typeof body.name === "string" && body.name.trim()) {
      tag = await renameDevoteeTag(tagId, body.name, check.operator.name);
    }
    if (typeof body.isActive === "boolean") {
      tag = await setDevoteeTagActive(tagId, body.isActive, check.operator.name);
    }
    if (!tag) {
      return NextResponse.json({ error: "請提供要修改的欄位（name 或 isActive）" }, { status: 400 });
    }
    return NextResponse.json({ tag });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "修改標籤失敗" }, { status: 400 });
  }
}
