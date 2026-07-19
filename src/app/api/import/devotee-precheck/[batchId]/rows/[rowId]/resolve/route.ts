/**
 * V11.3「信眾資料匯入預檢中心」——第三步：對「疑似重複／待確認家戶」的某
 * 一列做出人工最終決定（需求確認④：這個決定要長期保存，不用每次重新判斷）。
 *
 * POST /api/import/devotee-precheck/xxx/rows/yyy/resolve
 *   body: {
 *     operatorUserId,
 *     decision: "CONFIRMED_DUPLICATE" | "CONFIRMED_NOT_DUPLICATE" | "ASSIGN_HOUSEHOLD" | "SKIP",
 *     householdId?,  // ASSIGN_HOUSEHOLD 必填；CONFIRMED_DUPLICATE 選填（確認是哪一戶的哪個人）
 *     memberId?,     // CONFIRMED_DUPLICATE 選填
 *     note?,
 *   }
 */
import { NextResponse } from "next/server";
import type { ImportRowResolutionDecision } from "@prisma/client";
import { assertSystemPermissionForOperator } from "@/lib/operator";
import { resolveDevoteeImportRow } from "@/lib/devoteeImportBatch";

const VALID_DECISIONS: ImportRowResolutionDecision[] = [
  "CONFIRMED_DUPLICATE",
  "CONFIRMED_NOT_DUPLICATE",
  "ASSIGN_HOUSEHOLD",
  "SKIP",
];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ batchId: string; rowId: string }> }
) {
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "請提供決定內容" }, { status: 400 });

  const check = await assertSystemPermissionForOperator(body.operatorUserId, "manageDataImport");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  if (!VALID_DECISIONS.includes(body.decision)) {
    return NextResponse.json({ error: "決定內容不正確，請重新選擇" }, { status: 400 });
  }

  const { batchId, rowId } = await params;
  const result = await resolveDevoteeImportRow(batchId, rowId, {
    decision: body.decision,
    householdId: typeof body.householdId === "string" ? body.householdId : null,
    memberId: typeof body.memberId === "string" ? body.memberId : null,
    note: typeof body.note === "string" ? body.note : null,
    operatorName: check.operator.name,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
