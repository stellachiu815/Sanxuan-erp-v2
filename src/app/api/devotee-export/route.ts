import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getDevoteeExport } from "@/lib/devoteeExport";

/**
 * V38 信眾資料匯出 Excel：以戶分組、每位成員一列、含祭祀資料（永久牌位＋當年度普渡報名）。
 * GET /api/devotee-export?year=115&operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const year = Number(new URL(request.url).searchParams.get("year")) || new Date().getFullYear() - 1911;
  const data = await getDevoteeExport(year);

  const wb = XLSX.utils.book_new();
  const stat = [`家戶 ${data.householdCount} 戶／信眾 ${data.memberCount} 位`];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([stat, data.header, ...data.rows]), "信眾資料");

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(`信眾資料總表_民國${data.year}年.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
