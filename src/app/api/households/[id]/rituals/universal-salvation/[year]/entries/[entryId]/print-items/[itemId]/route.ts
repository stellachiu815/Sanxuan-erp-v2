import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { AdditionalPrintItemType } from "@prisma/client";
import {
  updateAdditionalPrintItem,
  type UpdateAdditionalPrintItemInput,
} from "@/lib/additionalPrintItems";
import { additionalPrintItemTypeLabel } from "@/lib/labels";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * 修改一筆附加列印項目（需求「四、編輯」）。
 *
 * PATCH /api/households/F00009/rituals/universal-salvation/115/entries/xxx/print-items/yyy
 * body（欄位都選填）: {
 *   "itemType": "POCKET",
 *   "usesSourceName": false,
 *   "customPrintName": "王某某",
 *   "quantity": 2,
 *   "isExtra": true,
 *   "templateId": "xxx",
 *   "note": "備註",
 *   "isChargeable": false,
 *   "unitPrice": null,
 *   "operatorName": "操作人姓名"
 * }
 *
 * ⚠️ 若這筆項目已經列印過，修改仍會成功，但回傳的 alreadyPrintedWarning=true
 * ——前端必須顯示警告（需求「十四」：已列印後修改需顯示警告）。版本紀錄
 * 一律會寫，不管有沒有列印過。
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string; itemId: string }> }
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

  const { id: householdId, year: yearParam, entryId, itemId } = await params;

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

  const input: UpdateAdditionalPrintItemInput = {};

  if ("itemType" in body) {
    const itemType = typeof body.itemType === "string" ? body.itemType : "";
    if (!(itemType in additionalPrintItemTypeLabel)) {
      return NextResponse.json({ error: "附加項目類型不正確" }, { status: 400 });
    }
    input.itemType = itemType as AdditionalPrintItemType;
  }
  if ("usesSourceName" in body) input.usesSourceName = Boolean(body.usesSourceName);
  if ("customPrintName" in body) input.customPrintName = toNullableString(body.customPrintName);
  if ("quantity" in body) {
    const quantity = Number(body.quantity);
    if (!Number.isInteger(quantity) || quantity < 1) {
      return NextResponse.json({ error: "數量必須是至少 1 的整數" }, { status: 400 });
    }
    input.quantity = quantity;
  }
  if ("isExtra" in body) input.isExtra = Boolean(body.isExtra);
  if ("templateId" in body) input.templateId = toNullableString(body.templateId);
  if ("note" in body) input.note = toNullableString(body.note);
  if ("isChargeable" in body) input.isChargeable = Boolean(body.isChargeable);
  if ("unitPrice" in body) input.unitPrice = typeof body.unitPrice === "number" ? body.unitPrice : null;

  const result = await updateAdditionalPrintItem(
    householdId,
    year,
    entryId,
    itemId,
    input,
    check.operator.name
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ item: result.item, alreadyPrintedWarning: result.alreadyPrintedWarning });
}
