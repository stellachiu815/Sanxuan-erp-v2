import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UniversalSalvationEntryCategory } from "@prisma/client";
import { createUniversalSalvationEntry } from "@/lib/ritual";
import { universalSalvationEntryCategoryLabel } from "@/lib/labels";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId, readJsonBody } from "@/lib/requestOperator";

/**
 * 新增一筆普渡登記項目（歷代祖先／個人乙位正魂／冤親債主／無緣子女其中一類）。
 *
 * POST /api/households/F00009/rituals/universal-salvation/115/entries
 * body: {
 *   "category": "ANCESTOR_LINE",
 *   "displayName": "王姓歷代祖先",
 *   "yangshangName": "王昆郎",
 *   "notes": "備註"
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; year: string }> }
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

  const { id: householdId, year: yearParam } = await params;

  const year = Number(yearParam);
  if (!Number.isInteger(year)) {
    return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  }

  const body = await readJsonBody(request);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  const category = typeof body.category === "string" ? body.category : "";
  if (!(category in universalSalvationEntryCategoryLabel)) {
    return NextResponse.json({ error: "登記項目類別不正確" }, { status: 400 });
  }

  const displayName = typeof body.displayName === "string" ? body.displayName.trim() : "";
  if (!displayName) {
    return NextResponse.json({ error: "請輸入名稱" }, { status: 400 });
  }

  const toNullableString = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const trimmed = v.trim();
    return trimmed ? trimmed : null;
  };

  const result = await createUniversalSalvationEntry(
    householdId,
    year,
    {
      category: category as UniversalSalvationEntryCategory,
      displayName,
      yangshangName: toNullableString(body.yangshangName),
      notes: toNullableString(body.notes),
    },
    check.operator.name
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  revalidatePath(`/household/${householdId}/rituals/universal-salvation`);

  return NextResponse.json({ record: result.record }, { status: 201 });
}
