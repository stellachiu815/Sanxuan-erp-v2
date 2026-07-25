import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import {
  confirmRegistration,
  cancelRegistration,
  validateForConfirm,
} from "@/lib/activityRegistration";
import { checkRitualRecordCompleteness, incompleteDataPayload } from "@/lib/completenessGate";

/**
 * V13.4：確認報名 / 取消報名。
 *
 * GET    ?operatorUserId=xxx   預檢：目前是否可以確認（列出缺什麼）
 * POST   { operatorUserId }    DRAFT → CONFIRMED，並產生列印快照
 * DELETE { operatorUserId }    取消報名（保留歷史）
 *
 * ⚠️ 確認的必要條件由**伺服器**判斷（validateForConfirm），
 * 未通過一律維持 DRAFT，不會產生「看起來完成、實際缺資料」的報名。
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request),
    "view"
  );
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const validation = await validateForConfirm(ritualRecordId);
  // V15R3：預檢一併回報資料完整度缺項（純讀取，不寫入），供前端顯示「⚠ 缺牌位地址…」。
  const completeness = await checkRitualRecordCompleteness(ritualRecordId);

  return NextResponse.json({
    ok: true,
    canConfirm: validation.ok && completeness.complete,
    reasons: validation.ok ? [] : validation.reasons,
    missingFields: completeness.missing.map((m) => m.label),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "register");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  // V15R3：正式確認前套用資料完整度驗證（純讀取）。缺資料 → 422 結構化錯誤，維持草稿、不確認。
  const completeness = await checkRitualRecordCompleteness(ritualRecordId);
  if (!completeness.complete) {
    return NextResponse.json(incompleteDataPayload(completeness), { status: 422 });
  }

  const result = await confirmRegistration(ritualRecordId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({
    ok: true,
    snapshotsGenerated: result.snapshotsGenerated,
    message: `已確認報名，並產生 ${result.snapshotsGenerated} 位成員的列印資料。`,
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ ritualRecordId: string }> }
) {
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertRitualRegistrationPermissionForOperator(operatorUserId, "cancel");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { ritualRecordId } = await params;
  const result = await cancelRegistration(ritualRecordId, check.operator.name);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ok: true, message: "已取消這筆報名，歷史紀錄仍保留。" });
}
