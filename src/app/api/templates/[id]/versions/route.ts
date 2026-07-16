import { NextRequest, NextResponse } from "next/server";
import { addTemplateVersion } from "@/lib/templates";

/**
 * 新增模板版本（實際上傳 Word/Excel/PDF 原始檔後呼叫）。
 *
 * ⚠️ 沙盒環境無法真的儲存二進位檔案，這裡先只存檔名/備註/版本標籤，
 * fileUrl 留空——真正上線後接檔案儲存服務即可，資料模型不用改，見交付
 * 說明的誠實限制章節。
 *
 * POST /api/templates/xxx/versions
 *   body: { "versionLabel": "2026-07-16", "fileName": "光明燈燈牌.docx", "note": "備註", "activate": true }
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body.versionLabel !== "string" || !body.versionLabel.trim()) {
    return NextResponse.json({ error: "請提供版本標籤" }, { status: 400 });
  }

  const result = await addTemplateVersion(id, {
    versionLabel: body.versionLabel.trim(),
    fileName: typeof body.fileName === "string" ? body.fileName : null,
    fileUrl: typeof body.fileUrl === "string" ? body.fileUrl : null,
    note: typeof body.note === "string" ? body.note : null,
    activate: Boolean(body.activate),
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ id: result.data.id }, { status: 201 });
}
