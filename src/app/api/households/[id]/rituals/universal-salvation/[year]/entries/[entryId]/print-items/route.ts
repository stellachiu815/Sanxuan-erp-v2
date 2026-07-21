import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { AdditionalPrintItemType } from "@prisma/client";
import {
  listAdditionalPrintItemsForEntry,
  createAdditionalPrintItem,
  type CreateAdditionalPrintItemInput,
} from "@/lib/additionalPrintItems";
import { additionalPrintItemTypeLabel } from "@/lib/labels";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * V9.1「寶袋與附加列印」面板：某一筆普渡登記項目（歷代祖先／個人乙位正魂／
 * 冤親債主／無緣子女）底下所有附加列印項目的清單／新增。
 *
 * GET /api/households/F00009/rituals/universal-salvation/115/entries/xxx/print-items
 *
 * POST（需求「四、＋新增寶袋」）
 * body: {
 *   "itemType": "POCKET",
 *   "usesSourceName": true,               // true=沿用原祭祀名稱，false=用下面的 customPrintName
 *   "customPrintName": "王某某",           // usesSourceName=false 時必填
 *   "quantity": 1,
 *   "isExtra": true,                       // 預設寶袋一般由活動精靈/系統規則自動建立，人工新增一律視為額外
 *   "templateId": "xxx",                   // 選填
 *   "note": "備註",                        // 選填
 *   "isChargeable": false,                 // 選填，需求「十一」收費預留
 *   "unitPrice": null,                     // 選填
 *   "operatorName": "操作人姓名"
 * }
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string }> }
) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = new URL(request.url).searchParams.get("operatorUserId");
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "view");
  if (!check.ok) {
    return NextResponse.json({ error: check.error }, { status: check.status });
  }

  const { id: householdId, year: yearParam, entryId } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const result = await listAdditionalPrintItemsForEntry(householdId, year, entryId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  return NextResponse.json({ items: result.items });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string; entryId: string }> }
) {
  /**
   * V13.3A：伺服器端權限檢查。在**任何**資料讀寫之前執行。
   * 未通過一律直接回傳，不會產生半套寫入、不洩漏任何資料內容。
   */
  const operatorUserId = await readOperatorUserId(request);
  const check = await assertUniversalSalvationPermissionForOperator(operatorUserId, "create");
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

  const itemType = typeof body.itemType === "string" ? body.itemType : "";
  if (!(itemType in additionalPrintItemTypeLabel)) {
    return NextResponse.json({ error: "附加項目類型不正確" }, { status: 400 });
  }

  const usesSourceName = body.usesSourceName !== false; // 未帶這個欄位時預設沿用原祭祀名稱
  const quantity = Number(body.quantity ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    return NextResponse.json({ error: "數量必須是至少 1 的整數" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  if (!usesSourceName && !toNullableString(body.customPrintName)) {
    return NextResponse.json({ error: "請輸入自訂寶袋名稱" }, { status: 400 });
  }

  const input: CreateAdditionalPrintItemInput = {
    itemType: itemType as AdditionalPrintItemType,
    usesSourceName,
    customPrintName: toNullableString(body.customPrintName),
    quantity,
    isExtra: Boolean(body.isExtra),
    templateId: toNullableString(body.templateId),
    note: toNullableString(body.note),
    isChargeable: Boolean(body.isChargeable),
    unitPrice: typeof body.unitPrice === "number" ? body.unitPrice : null,
  };

  const result = await createAdditionalPrintItem(
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

  return NextResponse.json({ item: result.item }, { status: 201 });
}
