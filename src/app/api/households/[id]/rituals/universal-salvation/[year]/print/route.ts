import { NextRequest, NextResponse } from "next/server";
import { getUniversalSalvationPrintData } from "@/lib/ritual";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";

/**
 * 普渡列印資料格式 API（本次只完成資料格式，不產生 PDF）。
 *
 * GET /api/households/F00009/rituals/universal-salvation/115/print
 *
 * 回傳依「歷代祖先 → 個人乙位正魂 → 冤親債主 → 無緣子女」固定順序分類好
 * 的名冊資料，之後要做 PDF 列印時，直接拿這支的回傳內容去排版即可。
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

  const printData = await getUniversalSalvationPrintData(householdId, year);
  if (!printData) {
    return NextResponse.json(
      { error: `找不到 ${year} 年的普渡資料，無法產生列印格式` },
      { status: 404 }
    );
  }

  return NextResponse.json(printData);
}
