import { NextResponse } from "next/server";
import { setActiveTemplateVersion } from "@/lib/templates";

/**
 * 標記某個版本為目前正式使用中的版本。
 *
 * POST /api/templates/xxx/versions/yyy/activate
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string; versionId: string }> }) {
  const { id, versionId } = await params;
  const result = await setActiveTemplateVersion(id, versionId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true });
}
