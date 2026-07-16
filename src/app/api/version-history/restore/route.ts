import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { restoreToVersion } from "@/lib/versionRestore";

/**
 * 回復到指定的歷史版本（V8.0「資料版本紀錄」）。
 *
 * POST /api/version-history/restore
 * body: {
 *   "entityType": "Household",
 *   "entityId": "F00009",
 *   "versionId": "xxx",
 *   "operatorName": "操作人姓名"   // 選填
 * }
 *
 * ⚠️ 系統目前沒有登入/session 機制，operatorName 是自由文字，見
 * src/lib/recordVersion.ts 開頭的說明。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const entityType = typeof body.entityType === "string" ? body.entityType : "";
  const entityId = typeof body.entityId === "string" ? body.entityId : "";
  const versionId = typeof body.versionId === "string" ? body.versionId : "";
  const operatorName = typeof body.operatorName === "string" ? body.operatorName : null;

  if (!entityType || !entityId || !versionId) {
    return NextResponse.json(
      { error: "請提供 entityType、entityId、versionId" },
      { status: 400 }
    );
  }

  const result = await restoreToVersion(entityType, entityId, versionId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  for (const path of result.revalidatePaths) {
    revalidatePath(path);
  }

  return NextResponse.json({ ok: true });
}
