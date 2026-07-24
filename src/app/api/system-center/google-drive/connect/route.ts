import { NextRequest, NextResponse } from "next/server";
import { buildAuthUrl } from "@/lib/googleDrive";
import { createPendingOAuthState } from "@/lib/oauthStateStore";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * POST /api/system-center/google-drive/connect
 *   body: { operatorUserId }
 * 需求「二」：管理員按【連結Google Drive】。回傳一個 Google 授權網址，
 * 前端收到後導頁過去（window.location.href = authUrl）。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "manageGoogleDriveConnection");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  try {
    const state = createPendingOAuthState(check.operator.name);
    const authUrl = buildAuthUrl(state, "fa0225234163@gmail.com");
    return NextResponse.json({ authUrl });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "無法產生授權連結" }, { status: 500 });
  }
}
