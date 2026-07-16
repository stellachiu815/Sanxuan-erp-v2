import { NextRequest, NextResponse } from "next/server";
import { getMonthlyCollectionReport } from "@/lib/collectionCenter";

/**
 * GET /api/collection-center/monthly-report?year=115&month=7
 * 月結收款報表——所有數字都直接來自真實收款資料彙總，不做人工輸入。
 * 匯出格式：這支 API 回傳 JSON 給畫面預覽/列印；Excel 匯出見畫面上的
 * 「下載 CSV」按鈕（可直接用 Excel 開啟），正式 PDF 排版樣式留待之後
 * 有需要時再開發。
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "請提供正確的年度與月份" }, { status: 400 });
  }
  const report = await getMonthlyCollectionReport(year, month);
  return NextResponse.json(report);
}
