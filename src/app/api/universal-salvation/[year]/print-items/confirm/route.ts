import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { confirmPrintObjects } from "@/lib/additionalPrintItems";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * V14.4「確認完成列印」：普渡列印物件（TABLET／POCKET）首印／補印確認。
 *
 * POST /api/universal-salvation/115/print-items/confirm
 * body: {
 *   "ids": ["<additionalPrintItemId>", ...],   // 使用者在列印中心勾選、且 PDF/列印頁已成功產生
 *   "idempotencyKey": "<前端本次列印的穩定識別碼>",  // 防止重送/連點重複累加
 *   "templateVersionId": "xxx"                 // 選填
 * }
 *
 * ⚠️ 只在使用者按下「確認完成列印」時呼叫（PDF／列印頁成功產生後），不因
 * 開啟預覽而累加。操作人一律取自 session；READONLY 無 "print" 權限 → 403。
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  // 權限＋登入：在任何寫入前檢查。READONLY 沒有 "print" → 直接 403。
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "print");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  if (!Number.isInteger(Number(yearParam))) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = await readJsonBody(request);
  const ids = Array.isArray(body?.ids) ? body!.ids.filter((x): x is string => typeof x === "string") : [];
  if (ids.length === 0) return NextResponse.json({ error: "請至少選擇一筆要確認完成列印的項目" }, { status: 400 });

  const idempotencyKey = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey) return NextResponse.json({ error: "缺少列印確認識別碼（idempotencyKey）" }, { status: 400 });

  const templateVersionId = typeof body?.templateVersionId === "string" ? body.templateVersionId : null;

  const result = await confirmPrintObjects(ids, {
    userId: check.operator.id, // 一律 session 使用者，忽略前端傳入身分
    operatorName: check.operator.name,
    idempotencyKey,
    templateVersionId,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

  revalidatePath("/rituals/universal-salvation/print-center");
  return NextResponse.json(
    {
      batchId: result.batchId,
      printedCount: result.printedCount,
      reprintedCount: result.reprintedCount,
      deduplicated: result.deduplicated,
    },
    { status: result.deduplicated ? 200 : 201 }
  );
}
