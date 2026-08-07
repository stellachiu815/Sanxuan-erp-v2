import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getUniversalSalvationRosterExport } from "@/lib/universalSalvationRosterExport";

/**
 * V30.6：中元普渡「活動總名單」Excel 匯出（民國年）。四工作表：祖先＋乙位／冤親／白米／贊普。
 * 依 registrationOrder 排序、取消/刪除不列入、與畫面名單同一 CONFIRMED 條件。不改財務 Excel。
 * GET /api/universal-salvation/[year]/roster-export?operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ year: string }> }
) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const data = await getUniversalSalvationRosterExport(year);
  const wb = XLSX.utils.book_new();
  // 每張工作表頂部放「統計」行（各項目人數），再放表頭與資料列。
  const add = (name: string, sheet: { header: string[]; stat: string; rows: (string | number)[][] }) =>
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[sheet.stat], sheet.header, ...sheet.rows]), name);
  // V38：工作表照列印批次歸類（表一黃紙、表二粉紅），方便對牌位與手寫本。
  add("祖先+乙位正魂+地基主", data.sheets.ancestorSoul);
  add("累世冤親債主+無緣子女", data.sheets.creditorUnborn);
  add("白米", data.sheets.rice);
  add("贊普+隨喜贊普", data.sheets.sponsor);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(`民國${year}年${data.activityName}報名總名單.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
