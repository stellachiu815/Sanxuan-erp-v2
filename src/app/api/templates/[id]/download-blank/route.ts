import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { getBlankTemplateColumns } from "@/lib/templates";

/**
 * 下載空白 Excel 模板（需求「七」：管理者可下載空白模板）。只有
 * getBlankTemplateColumns() 有定義欄位的模板才能下載，見 lib/templates.ts
 * 的說明——沒有欄位定義的模板一律回傳 404，不會自己編造一份欄位規格。
 *
 * GET /api/templates/xxx/download-blank
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const definition = await prisma.templateDefinition.findUnique({ where: { id } });
  if (!definition) {
    return NextResponse.json({ error: "找不到這個模板" }, { status: 404 });
  }

  const columns = getBlankTemplateColumns(definition.key);
  if (!columns) {
    return NextResponse.json({ error: "這個模板目前還沒有提供空白範本下載" }, { status: 404 });
  }

  const worksheet = XLSX.utils.aoa_to_sheet([columns]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "範本");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;

  return new NextResponse(buffer, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${encodeURIComponent(definition.name)}_範本.xlsx"`,
    },
  });
}
