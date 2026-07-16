import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { moveAdditionalPrintItemToRecycleBin } from "@/lib/additionalPrintItems";

/**
 * 將一筆已取消的附加列印項目移入回收區（需求「十三」：永久刪除的第一步，
 * 前端必須先要求「雙重確認」才呼叫這支，且只有已經是「取消」狀態的項目
 * 才能移入回收區）。移入回收區後，真正的永久刪除（超過 30 天保留期限後）
 * 走既有的 POST /api/recycle-bin/purge，entityType 傳 "AdditionalPrintItem"。
 *
 * POST /api/households/F00009/rituals/universal-salvation/115/entries/xxx/print-items/yyy/delete
 * body（選填）: { "operatorName": "操作人姓名" }
 *
 * ⚠️ 需求「十四」要求「只有 SUPER_ADMIN 能永久刪除」。跟這個專案其他
 * SUPER_ADMIN 限定的動作一樣（見 /api/purification/banned-numbers 的說明），
 * 系統目前沒有登入/session 機制，後端暫時無法驗證操作者身份，這是已知
 * 風險：等登入機制做出來，必須在這支 API 補上
 * assertAdditionalPrintItemPermission(user.role, "permanentlyDelete") 的真正
 * 檢查（規則定義已經寫在 src/lib/permissions.ts）。目前只能靠前端把這個
 * 入口隱藏成只有管理者身分才看得到，並要求雙重確認對話框。
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string; itemId: string }> }
) {
  const { id: householdId, itemId } = await params;

  const body = await request.json().catch(() => ({}));
  const operatorName =
    body && typeof body === "object" && typeof body.operatorName === "string" ? body.operatorName : null;

  const result = await moveAdditionalPrintItemToRecycleBin(itemId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);
  revalidatePath("/system/recycle-bin");

  return NextResponse.json({ item: result.item });
}
