import { NextResponse } from "next/server";
import { getPurificationYearOverview } from "@/lib/purification";

/**
 * 單一祭改年度總覽（含每位報名者的解析後資料，以及「待確認清單」）。
 *
 * GET /api/purification/years/xxx
 *
 * 待確認清單（needsConfirmation）就是需求「十三、列印預覽」列出的那些
 * 不得直接列印的狀況（性別未填/農曆生日未填/歲數無法計算/地址未填/
 * 編號重複/誤用禁用編號/版面最佳化後仍放不下），已取消的報名者不會出現
 * 在待確認清單裡。
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ yearId: string }> }
) {
  const { yearId } = await params;

  const overview = await getPurificationYearOverview(yearId);
  if (!overview) {
    return NextResponse.json({ error: "找不到這個祭改年度" }, { status: 404 });
  }

  return NextResponse.json(overview);
}
