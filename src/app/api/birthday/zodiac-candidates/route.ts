import { NextRequest, NextResponse } from "next/server";
import { getCandidateBirthYearsByZodiac, getZodiacOptions } from "@/lib/lunar";

/**
 * 依生肖查詢候選出生年 API（V5.0 新增）。
 *
 * GET /api/birthday/zodiac-candidates?zodiac=虎
 *
 * 只知道生肖、不確定確切出生年時使用：列出過去 100 年內符合這個生肖的所有
 * 農曆年份，附上虛歲（虛歲只需要年份就能精確算出）。行政人員選定年份後，
 * 前端會把該年份帶回農曆輸入欄位，之後如果補得到確切月日，再完整輸入即可
 * 看到含實歲的完整換算。
 */
export async function GET(request: NextRequest) {
  const zodiac = request.nextUrl.searchParams.get("zodiac") ?? "";
  if (!zodiac) {
    return NextResponse.json({ error: "請提供 zodiac 參數" }, { status: 400 });
  }
  if (!getZodiacOptions().includes(zodiac)) {
    return NextResponse.json({ error: "不是有效的生肖" }, { status: 400 });
  }

  const candidates = getCandidateBirthYearsByZodiac(zodiac);
  return NextResponse.json({ zodiac, candidates });
}
