import { NextRequest, NextResponse } from "next/server";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { previewHouseholdMerge, toHouseholdApiError } from "@/lib/householdManagement";

/**
 * V12.1「家戶管理中心」指令「十一、家戶合併」。
 * POST /api/households/merge/preview  body: { operatorUserId, targetId, sourceId }
 *
 * 預覽本身不寫入任何資料，但仍要求權限——避免沒有修改權限的角色（例如
 * READONLY）也能看到合併預覽，統一跟其他家戶管理操作一樣的門檻。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "請求格式錯誤" }, { status: 400 });
    }

    const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "mergeHousehold");
    if (!check.ok) return NextResponse.json({ success: false, error: check.error }, { status: check.status });

    if (typeof body.targetId !== "string" || typeof body.sourceId !== "string") {
      return NextResponse.json({ success: false, error: "請選擇目標家戶與來源家戶" }, { status: 400 });
    }

    const preview = await previewHouseholdMerge(body.targetId, body.sourceId);
    return NextResponse.json({ success: true, data: preview });
  } catch (e) {
    const { status, error } = toHouseholdApiError(e);
    return NextResponse.json({ success: false, error }, { status });
  }
}
