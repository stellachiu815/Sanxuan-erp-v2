import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { listFloralOfferingRoster } from "@/lib/offeringClaims";
import { formatFloralSlotDate } from "@/lib/offeringRules";
import { offeringPaymentStatusLabel } from "@/lib/labels";

/**
 * 需求「十二、花果供品年度名單」：全年 24 次的認捐狀況，支援依農曆日期
 * 排序、顯示尚未認捐日期、顯示未收款資料、匯出 Excel、一般 A4 工作清單
 * 列印（不做牆面超長版型——這份名單是給宮方工作人員查看，之後由師姐人工
 * 抄寫至牆面公告，見需求「十二」最後一句）。
 *
 * GET /api/temple-events/xxx/offerings/xxx/floral-roster            → JSON（畫面顯示/A4 網頁列印用）
 * GET /api/temple-events/xxx/offerings/xxx/floral-roster?format=xlsx → 下載 Excel
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ offeringId: string }> }
) {
  const { offeringId } = await params;
  const roster = await listFloralOfferingRoster(offeringId);

  const rows = roster.map(({ slot, claim }) => ({
    floralSlotId: slot.id,
    lunarDate: formatFloralSlotDate(slot.lunarMonth, slot.lunarDay),
    sponsorName: claim?.sponsorNameSnapshot ?? "（尚未認捐）",
    amount: claim ? Number(claim.unitPrice ?? 0) * claim.quantity : null,
    paymentStatus: claim ? offeringPaymentStatusLabel[claim.paymentStatus] ?? claim.paymentStatus : null,
    receiptNumbers: claim ? claim.payments.map((p) => p.receiptNumber).filter(Boolean).join("、") : "",
    note: claim?.note ?? slot.note ?? "",
    isActive: slot.isActive,
  }));

  const format = request.nextUrl.searchParams.get("format");
  if (format === "xlsx") {
    const header = ["農曆日期", "認捐人", "金額", "收款狀態", "收據號碼", "備註"];
    const body = rows.map((r) => [r.lunarDate, r.sponsorName, r.amount ?? "", r.paymentStatus ?? "", r.receiptNumbers, r.note]);
    const worksheet = XLSX.utils.aoa_to_sheet([header, ...body]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "花果供品年度名單");
    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="花果供品年度名單.xlsx"`,
      },
    });
  }

  return NextResponse.json({ rows });
}
