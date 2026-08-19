import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertRitualRegistrationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";
import { getNameListRosterExport } from "@/lib/nameListRosterExport";

/**
 * V41 名單型活動（補庫／宮燈）「報名總名單」Excel 匯出（民國年）。
 * 一張工作表：作業號｜姓名｜家戶｜地址｜電話｜金額｜收款狀態｜列印狀態。
 * GET /api/print-center/name-list-roster/[itemKey]/[year]?operatorUserId=xxx
 */
export const dynamic = "force-dynamic";

// 對外標籤（itemKey → 中文活動名）。只允許名單型項目，避免誤用。
const LABELS: Record<string, string> = {
  STORAGE_TROUSERS: "補庫",
  PALACE_LANTERN: "宮燈",
};

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ itemKey: string; year: string }> }
) {
  const check = await assertRitualRegistrationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { itemKey, year: yearParam } = await params;
  const year = Number(yearParam);
  if (!Number.isInteger(year)) return NextResponse.json({ error: "年度格式錯誤" }, { status: 400 });
  const label = LABELS[itemKey];
  if (!label) return NextResponse.json({ error: "這個項目不支援名單型總名單匯出" }, { status: 400 });

  const data = await getNameListRosterExport(itemKey, year, label);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[data.stat], data.header, ...data.rows]), label);

  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const filename = encodeURIComponent(`民國${year}年${label}報名總名單.xlsx`);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
    },
  });
}
