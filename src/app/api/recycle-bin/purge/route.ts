import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isRecycleBinEntityType, purgeRecycleBinItem } from "@/lib/recycleBin";

/**
 * 從回收區永久刪除一筆資料（V8.0「刪除保護」）。只有超過保留期限
 * （30 天）才允許執行，見 src/lib/recycleBin.ts 的 canPurgeOf()。
 *
 * POST /api/recycle-bin/purge
 * body: { "entityType": "RitualRecord", "entityId": "xxx" }
 *
 * ⚠️ 需求「九、權限」要求只有 SUPER_ADMIN 能永久刪除。系統目前沒有登入/
 * session 機制，這個限制目前只能靠畫面提示，還沒辦法真正擋下——同
 * /api/recycle-bin/restore 的說明，已列為風險事項。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const entityType = body.entityType;
  const entityId = typeof body.entityId === "string" ? body.entityId : "";

  if (!isRecycleBinEntityType(entityType) || !entityId) {
    return NextResponse.json({ error: "請提供正確的 entityType 與 entityId" }, { status: 400 });
  }

  const result = await purgeRecycleBinItem(entityType, entityId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath("/system/recycle-bin");

  return NextResponse.json({ ok: true });
}
