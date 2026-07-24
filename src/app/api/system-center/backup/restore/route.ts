import { NextRequest, NextResponse } from "next/server";
import { restoreFromBackup } from "@/lib/restore";
import { readOperatorUserId } from "@/lib/requestOperator";

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
  // V14.3：備份還原僅最高管理員（restoreFromBackup 內部查證 restoreBackup 權限）；
  // 操作人一律以登入 session 為準，不信任前端。
  const operatorUserId = await readOperatorUserId(request);
  if (!operatorUserId) {
    return NextResponse.json({ error: "尚未登入或帳號已停用，請重新登入" }, { status: 401 });
  }

  const result = await restoreFromBackup({
    googleDriveFileId: body.googleDriveFileId,
    fileName: body.fileName,
    confirmFileName: body.confirmFileName,
    operatorUserId,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  return NextResponse.json({ ok: true });
}
