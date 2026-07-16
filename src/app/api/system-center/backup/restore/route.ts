import { NextRequest, NextResponse } from "next/server";
import { restoreFromBackup } from "@/lib/restore";

/**
 * POST /api/system-center/backup/restore
 *   body: { operatorUserId, googleDriveFileId, fileName, confirmFileName }
 * 需求「九、一鍵還原」：權限與二次確認（confirmFileName 必須完全等於
 * fileName）都在 restoreFromBackup() 內部完成，這裡只負責基本欄位驗證。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "請提供還原資訊" }, { status: 400 });
  if (typeof body.googleDriveFileId !== "string" || !body.googleDriveFileId) {
    return NextResponse.json({ error: "請提供要還原的備份檔案" }, { status: 400 });
  }
  if (typeof body.fileName !== "string" || !body.fileName) {
    return NextResponse.json({ error: "請提供備份檔名" }, { status: 400 });
  }
  if (typeof body.confirmFileName !== "string" || !body.confirmFileName) {
    return NextResponse.json({ error: "請輸入完整檔名以確認還原" }, { status: 400 });
  }
  if (typeof body.operatorUserId !== "string" || !body.operatorUserId) {
    return NextResponse.json({ error: "請提供操作人員身分" }, { status: 400 });
  }

  const result = await restoreFromBackup({
    googleDriveFileId: body.googleDriveFileId,
    fileName: body.fileName,
    confirmFileName: body.confirmFileName,
    operatorUserId: body.operatorUserId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
