import { NextRequest, NextResponse } from "next/server";
import { listDevoteeTags, createDevoteeTag } from "@/lib/devoteeTags";
import { assertDevoteePermissionForOperator } from "@/lib/operator";

/**
 * GET /api/devotee-center/tags?operatorUserId=xxx&includeInactive=1
 * 對應指令「八、信眾標籤」：列出全部標籤（含已停用，供管理畫面顯示狀態）。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(searchParams.get("operatorUserId"), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const includeInactive = searchParams.get("includeInactive") !== "0";
  const tags = await listDevoteeTags(includeInactive);
  return NextResponse.json({ tags });
}

/**
 * POST /api/devotee-center/tags
 *   body: { operatorUserId, name, note? }
 * 對應指令「八」：管理者可新增自訂標籤（SUPER_ADMIN 專屬，見權限矩陣
 * manageTags）。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body.name !== "string" || !body.name.trim()) {
    return NextResponse.json({ error: "請提供標籤名稱" }, { status: 400 });
  }

  const check = await assertDevoteePermissionForOperator(body.operatorUserId, "manageTags");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const tag = await createDevoteeTag(body.name.trim(), check.operator.name, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ tag }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "新增標籤失敗" }, { status: 400 });
  }
}
