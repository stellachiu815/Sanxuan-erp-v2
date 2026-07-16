import { NextResponse } from "next/server";
import { getZodiacOptions } from "@/lib/lunar";

/**
 * 12 生肖選項 API（V5.0 新增）。
 *
 * GET /api/birthday/zodiac-options
 *
 * 直接用農曆換算函式庫實際算出今年往前 12 個農曆年份的生肖，不寫死中文字串，
 * 保證跟系統其他地方顯示的生肖用字一致（見 src/lib/lunar.ts 的 getZodiacOptions）。
 */
export async function GET() {
  return NextResponse.json({ options: getZodiacOptions() });
}
