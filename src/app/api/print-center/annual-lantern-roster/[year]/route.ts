import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getAnnualLanternRosterExport } from "@/lib/annualLanternRosterExport";

/**
 * V41 年度燈「報名總名單」Excel 匯出（民國年）。照燈別分工作表：光明燈／太歲燈／祭改／全家燈。
 * 每張表欄位：作業號｜姓名｜農曆生日｜生肖｜歲數｜地址｜份數｜收款狀態｜列印狀態。
 * GET /api/print-center/annual-lantern-roster/[year]?operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });

  const data = await getAnnualLanternRosterExport(year);
  const wb = XLSX.utils.book_new();
  for (const s of data.sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[s.sheet.stat], s.sheet.header, ...s.sheet.rows]), s.label);
  }

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(`民國${year}年年度燈報名總名單.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
