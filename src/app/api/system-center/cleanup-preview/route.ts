import { NextResponse } from "next/server";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { buildCleanupPreview } from "@/lib/testDataCleanupPreview";

/**
 * V13.1 指令十五：測試資料清理**預覽** API。
 *
 * GET /api/system-center/cleanup-preview?operatorUserId=xxx
 *
 * ⚠️ 這支只有 GET，**刻意沒有 POST / DELETE**。
 * 本輪的決定是「只產出清理預覽，不得執行任何刪除」，所以整條路由上
 * 不存在任何會修改資料的路徑——不是靠權限擋，是根本沒有這個端點。
 *
 * 真正的清理必須是下一輪、由使用者確認清單後另外處理，且需事前完整備份。
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  // 清理預覽會列出全宮的家戶概況，屬於系統管理層級資料，
  // 沿用既有的系統管理權限，不另建一套。
  const check = await assertSystemPermissionForOperator(
    searchParams.get("operatorUserId"),
    "manageDataImport"
  );
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const preview = await buildCleanupPreview();

  return NextResponse.json({
    ok: true,
    preview,
    notice:
      "這是唯讀預覽，沒有刪除任何資料。確認清單後，清理作業將於下一輪另行處理，且需事前完整備份。",
  });
}
