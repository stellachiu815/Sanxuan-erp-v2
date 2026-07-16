import { NextRequest, NextResponse } from "next/server";
import { testGoogleDriveConnection } from "@/lib/googleDrive";
import { assertSystemPermissionForOperator } from "@/lib/operator";

/**
 * POST /api/system-center/google-drive/test-connection
 *   body: { operatorUserId }
 *
 * 需求「四、增加測試 Google Drive 連線功能」：由後端真正逐項執行 6 項
 * 檢查（見 src/lib/googleDrive.ts 的 testGoogleDriveConnection()），
 * 不是只在前端顯示假成功。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(body.operatorUserId, "manageGoogleDriveConnection");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await testGoogleDriveConnection();
  return NextResponse.json(result);
}
