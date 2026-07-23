import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  updateUniversalSalvationEntry,
  deleteUniversalSalvationEntry,
  type UpdateUniversalSalvationEntryInput,
} from "@/lib/ritual";

import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
import { normalizeYangshangNames } from "@/lib/yangshang";
/**
 * 修改單一筆普渡登記項目（名稱／陽上姓名／備註）。
 *
 * PATCH /api/households/F00009/rituals/universal-salvation/115/entries/xxx
 * body（欄位都選填）: { "displayName": "...", "yangshangName": "...", "notes": "..." }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string }> }
) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "update");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { id: householdId, year: yearParam, entryId } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  const input: UpdateUniversalSalvationEntryInput = {};
  if ("displayName" in body) {
    const name = typeof body.displayName === "string" ? body.displayName.trim() : "";
    if (!name) {
      return NextResponse.json({ error: "請輸入名稱" }, { status: 400 });
    }
    input.displayName = name;
  }
  if ("yangshangName" in body) input.yangshangName = toNullableString(body.yangshangName);
  // V14.1：整組覆蓋多位陽上人（清理後）；牌位地址可清空。
  if ("yangshangNames" in body) input.yangshangNames = normalizeYangshangNames(body.yangshangNames);
  if ("tabletAddress" in body) input.tabletAddress = toNullableString(body.tabletAddress);
  if ("notes" in body) input.notes = toNullableString(body.notes);

  const result = await updateUniversalSalvationEntry(
    householdId,
    year,
    entryId,
    input,
    check.operator.name
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ record: result.record });
}

/**
 * 刪除單一筆普渡登記項目（V8.0 起是軟刪除，移入回收區，見
 * src/lib/recycleBin.ts）。
 *
 * DELETE /api/households/F00009/rituals/universal-salvation/115/entries/xxx
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string }> }
) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "delete");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { id: householdId, year: yearParam, entryId } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = (await readJsonBody(request)) ?? {};
  const operatorName =
    check.operator.name;

  const result = await deleteUniversalSalvationEntry(householdId, year, entryId, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ record: result.record });
}
