import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { regeneratePrintSnapshots } from "@/lib/ritualParticipants";

/**
 * V13.4 指令十一：**重新產生列印資料**。
 *
 * POST /api/registrations/[ritualRecordId]/print-profile
 *
 * ── 為什麼需要一個明確的動作 ───────────────────────────────
 * 已列印的資料**不得被靜默覆蓋**。信眾之後改了生日或地址，已完成的
 * 活動列印快照不會自動跟著變——那會讓已經印出去的紙本與系統對不上。
 *
 * 要用新資料重印，必須由使用者明確執行這個動作：
 *   - 依**活動使用年度**重新計算農曆生日與虛歲（不是今天）
 *   - 記錄操作人與時間（recordVersion）
 *   - printProfileVersion +1，保留「這是第幾版列印資料」的軌跡
 */
export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const result = await regeneratePrintSnapshots(ritualRecordId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    updated: result.updated,
    message:
      `已依活動年度重新產生 ${result.updated} 位成員的列印資料（農曆生日與虛歲）。` +
      `先前列印過的內容仍保留在版本紀錄中。`,
  });
}
