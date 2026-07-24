import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { isRecycleBinEntityType, purgeRecycleBinItem } from "@/lib/recycleBin";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * 從回收區永久刪除一筆資料（V8.0「刪除保護」）。只有超過保留期限
 * （30 天）才允許執行，見 src/lib/recycleBin.ts 的 canPurgeOf()。
 *
 * POST /api/recycle-bin/purge
 * body: { "entityType": "RitualRecord", "entityId": "xxx" }
 *
 * 權限（V12.1 一次性修正指令「二之4」）：需求「九、權限」要求只有
 * SUPER_ADMIN 能永久刪除。這個限制原本只能靠畫面提示，沒有後端把關；現在
 * 沿用既有的 assertSystemPermissionForOperator()（跟系統管理中心備份／還原
 * 同一套機制，不另建第二套）真正擋下，對應新增的 SystemAction
 * "purgeRecycleBin"（僅 SUPER_ADMIN，見 src/lib/permissions.ts）。
 * 沒有帶 operatorUserId 回傳 401，角色不足回傳 403。
 *
 * 保留期限（30 天）是獨立的另一道關卡，仍由 purgeRecycleBinItem() 內部的
 * canPurgeOf() 判斷，沒有因為這次補權限而改變或放寬。
 *
 * ⚠️ /api/recycle-bin/restore 的權限缺口這次未一併處理（不在本次指令範圍
 * 內），仍列為既有風險事項。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const check = await assertSystemPermissionForOperator(await readOperatorUserId(request), "purgeRecycleBin");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

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
