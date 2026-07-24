import { NextRequest, NextResponse } from "next/server";
import { browseBackupFolder, type BrowseFolder } from "@/lib/backup";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

const VALID_FOLDERS: BrowseFolder[] = ["Daily", "Weekly", "Monthly", "Before_Update"];

/**
 * GET /api/system-center/backup/browse?operatorUserId=xxx&folder=Daily
 * 需求「九、一鍵還原」的瀏覽功能：直接向 Google Drive 查詢對應資料夾
 * 目前實際有哪些備份可以選擇還原。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "viewSystemCenter");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const folder = searchParams.get("folder") as BrowseFolder | null;
  if (!folder || !VALID_FOLDERS.includes(folder)) {
    return NextResponse.json({ error: "請提供有效的資料夾名稱（Daily/Weekly/Monthly/Before_Update）" }, { status: 400 });
  }

  try {
    const files = await browseBackupFolder(folder);
    return NextResponse.json({ files });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "查詢失敗" }, { status: 502 });
  }
}
