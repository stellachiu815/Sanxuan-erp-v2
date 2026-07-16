import { NextRequest, NextResponse } from "next/server";
import { disconnectGoogleDrive } from "@/lib/googleDrive";
import { assertSystemPermissionForOperator } from "@/lib/operator";

/**
 * POST /api/system-center/google-drive/disconnect
 *   body: { operatorUserId }
 * 需求「二」：管理員可以「解除授權」。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(body.operatorUserId, "manageGoogleDriveConnection");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  await disconnectGoogleDrive(check.operator.name);
  return NextResponse.json({ ok: true });
}
