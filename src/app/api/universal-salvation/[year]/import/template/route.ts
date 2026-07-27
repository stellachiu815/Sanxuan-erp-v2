import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { assertUniversalSalvationPermissionForOperator } from "@/lib/operator";
import { readOperatorUserId } from "@/lib/requestOperator";

/**
 * V15R7：下載普渡 Excel 匯入範本。
 * GET /api/universal-salvation/[year]/import/template
 *
 * 欄位相容既有正式 Excel（表頭別名見 purificationImportRules.FIELD_ALIASES），
 * 使用者可直接沿用既有檔案，此範本僅供沒有現成檔案者參考。純讀，不寫任何資料。
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ year: string }> }) {
  const check = await assertUniversalSalvationPermissionForOperator(await readOperatorUserId(request), "view");
  if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

  const { year } = await params;

  const headers = [
    "家戶編號", "家戶名稱", "報名人", "報名項目",
    "牌位姓名", "牌位地址", "陽上人", "數量", "單價", "隨喜金額", "備註",
  ];
  const examples = [
    ["F00001", "王家", "", "歷代祖先", "王姓歷代祖先", "台北市中山路1號", "王大明、王小華", "", "", "", ""],
    ["F00001", "王家", "王祖", "乙位正魂", "王祖 乙位正魂", "台北市中山路1號", "王大明", "", "", "", ""],
    ["F00002", "陳家", "陳報名", "累世冤親債主", "", "", "陳報名", "", "", "", "依報名人建立，不需牌位姓名"],
    ["F00002", "陳家", "陳報名", "白米", "", "", "", "10", "", "", "數量＝斤；單價依正式活動設定，Excel 不覆蓋"],
    ["F00003", "林家", "林隨喜", "隨喜贊普", "", "", "", "", "", "3000", "隨喜金額可由 Excel 讀入"],
  ];
  const aoa = [headers, ...examples];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "普渡報名");
  const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

  return new NextResponse(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="universal-salvation-import-template-${year}.xlsx"`,
    },
  });
}
