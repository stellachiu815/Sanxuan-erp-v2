import { NextRequest, NextResponse } from "next/server";
import { createBackup } from "@/lib/backup";
import { assertSystemPermissionForOperator } from "@/lib/operator";

/**
 * POST /api/system-center/backup/run
 *   body: { operatorUserId }
 * 需求「四、立即備份」：只有最高管理員可以執行（canSystem "runBackup"），
 * 伺服器端真的查資料庫驗證身分與角色。
 *
 * V11.2.1 補強（對應指令「七」）：這支 API 本身仍然是「等備份整個做完
 * 才回應」（同步），不是假裝立刻回應——因為 Render 這個服務是單一、
 * 長時間執行的 Node process，這段等待期間伺服器仍然可以同時處理其他
 * 請求（例如前端另外發出的 GET .../backup/run-status 輪詢請求，見該
 * 檔案），所以前端可以在等待這支 API 回應的同時，另外輪詢目前進度階段，
 * 不需要把這支 API 本身改成「先回應、背景繼續跑」的複雜設計。
 *
 * 如果目前已有另一個備份在執行中，createBackup() 會回傳
 * `{ ok:false, locked:true, activeBackupLogId, error }`，這裡用 409
 * （Conflict）回應，讓前端明確分辨「這不是備份失敗，是重複操作被擋下」。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const check = await assertSystemPermissionForOperator(body.operatorUserId, "runBackup");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const result = await createBackup({
    type: "MANUAL",
    executedByName: check.operator.name,
    executedByUserId: check.operator.id,
    isAutomatic: false,
  });

  if (!result.ok) {
    // 只用 "locked" in result 判斷（不額外加 && result.locked）——這個
    // union 型別裡只有「被鎖定」這個變體才有 locked 屬性，且一定是
        // true，用單純的 `in` 檢查讓 TypeScript 可以正確做型別窄化，
    // 避免下面存取 result.errorCode／failedStage 時型別還沒收斂。
    if ("locked" in result) {
      return NextResponse.json(
        { error: result.error, locked: true, activeBackupLogId: result.activeBackupLogId },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: result.error, errorCode: result.errorCode, failedStage: result.failedStage }, { status: 500 });
  }
  return NextResponse.json(result, { status: 201 });
}
