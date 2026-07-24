import { NextRequest, NextResponse } from "next/server";
import { listSuspectedDuplicateDevotees } from "@/lib/devoteeDuplicates";
import { assertDevoteePermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * GET /api/devotee-center/duplicates?operatorUserId=xxx
 * 對應指令「十三、疑似重複信眾」：只回傳比對結果，沒有任何合併功能
 * （見 src/lib/devoteeDuplicateMatcher.ts／devoteeDuplicates.ts 說明）。
 * 畫面必須顯示逐字文案：「疑似重複僅供人工確認，系統不會自動刪除或合併
 * 資料。」
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const check = await assertDevoteePermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const groups = await listSuspectedDuplicateDevotees();
  return NextResponse.json({ groups });
}
