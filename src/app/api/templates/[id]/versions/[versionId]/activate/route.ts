import { NextResponse } from "next/server";
import { setActiveTemplateVersion } from "@/lib/templates";
import { assertTemplatePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 標記某個版本為目前正式使用中的版本。
 *
 * POST /api/templates/xxx/versions/yyy/activate
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const __op = await assertTemplatePermissionForOperator(await readOperatorUserId(request), "activate");
  if (!__op.ok) return NextResponse.json({ error: __op.error }, { status: __op.status });
  const { id, versionId } = await params;
  const result = await setActiveTemplateVersion(id, versionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
