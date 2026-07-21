import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  deleteUniversalSalvationRecord,
  getUniversalSalvationRecord,
  updateUniversalSalvationDetail,
  type UpdateUniversalSalvationDetailInput,
} from "@/lib/ritual";

import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";
/**
 * 查詢某戶、某年度的普渡登記資料（主檔＋明細＋歷代祖先/個人乙位正魂/
 * 冤親債主/無緣子女登記項目）。
 *
 * GET /api/households/F00009/rituals/universal-salvation/115
 *
 * V3.0 普渡登記畫面會直接呼叫這支載入資料。
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string }> }
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

  const { id: householdId, year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const record = await getUniversalSalvationRecord(householdId, year);
  if (!record) {
    return NextResponse.json(
      { error: `找不到 ${year} 年的普渡資料` },
      { status: 404 }
    );
  }

  return NextResponse.json({ record });
}

/**
 * 修改某戶、某年度普渡登記的明細（陽上姓名／安奉位置／贊普／普渡桌／
 * 備註／是否報名），不會動到登記項目（歷代祖先等四類，另外用 entries 這支）。
 *
 * PATCH /api/households/F00009/rituals/universal-salvation/115
 * body（欄位都選填，只會更新有帶到的欄位）: {
 *   "isRegistered": true,
 *   "yangshangName": "王昆郎",
 *   "enshrinementLocation": "本宮普渡壇 A 區",
 *   "isSponsor": true,
 *   "sponsorQuantity": 2,
 *   "sponsorUnitPrice": 1000,
 *   "sponsorAmount": 2000,
 *   "sponsorNotes": "現金",
 *   "tableNumber": "A-12",
 *   "notes": "備註"
 * }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string }> }
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

  const { id: householdId, year: yearParam } = await params;

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

  const toNullableNumber = (v: unknown): number | null => {
    if (v === null || v === "" || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };

  const input: UpdateUniversalSalvationDetailInput = {};
  if ("isRegistered" in body) input.isRegistered = Boolean(body.isRegistered);
  if ("yangshangName" in body) input.yangshangName = toNullableString(body.yangshangName);
  if ("enshrinementLocation" in body)
    input.enshrinementLocation = toNullableString(body.enshrinementLocation);
  if ("isSponsor" in body) input.isSponsor = Boolean(body.isSponsor);
  if ("sponsorQuantity" in body) input.sponsorQuantity = toNullableNumber(body.sponsorQuantity);
  if ("sponsorUnitPrice" in body) input.sponsorUnitPrice = toNullableNumber(body.sponsorUnitPrice);
  if ("sponsorAmount" in body) input.sponsorAmount = toNullableNumber(body.sponsorAmount);
  if ("sponsorNotes" in body) input.sponsorNotes = toNullableString(body.sponsorNotes);
  if ("tableNumber" in body) input.tableNumber = toNullableString(body.tableNumber);
  if ("notes" in body) input.notes = toNullableString(body.notes);

  const result = await updateUniversalSalvationDetail(
    householdId,
    year,
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
 * 刪除某戶、某年度的普渡登記（V8.0 起是軟刪除，連同明細與登記項目一起移入
 * 回收區，不會動到家戶本身，見 src/lib/recycleBin.ts）。
 *
 * DELETE /api/households/F00009/rituals/universal-salvation/115
 * body（選填）: { "operatorName": "操作人姓名" }
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string }> }
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

  const { id: householdId, year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = (await readJsonBody(request)) ?? {};
  const operatorName =
    check.operator.name;

  const result = await deleteUniversalSalvationRecord(householdId, year, operatorName);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ ok: true });
}
