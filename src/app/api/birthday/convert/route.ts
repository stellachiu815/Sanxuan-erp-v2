import { NextRequest, NextResponse } from "next/server";
import {
  formatLunarDate,
  formatSolarDate,
  getActualAge,
  getNominalAge,
  getZodiacByLunarYear,
  lunarToSolar,
  parseSolarDateString,
  solarToLunar,
  validateLunarBirthdayInput,
} from "@/lib/lunar";

/** Date（UTC 純日期）→ "yyyy-MM-dd"，給前端 <input type="date"> 直接使用。 */
function toIsoDateString(date: Date): string {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * 生日換算 API（V5.0「生日與農曆中心」新增）。
 *
 * 這支只負責把國曆／農曆生日換算成完整資訊（另一種曆法、生肖、實歲、虛歲），
 * 不寫入任何資料——換算邏輯全部集中在 src/lib/lunar.ts，這裡只是包成 API，
 * 讓「生日與農曆中心」頁面跟未來各模組共用同一套換算結果，不用各自重寫。
 *
 * POST /api/birthday/convert
 * body（國曆）：{ "mode": "solar", "solarDate": "1990-05-10" }
 * body（農曆）：{ "mode": "lunar", "lunarYear": 1990, "lunarMonth": 4, "lunarDay": 20, "lunarIsLeapMonth": false }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "請求格式錯誤" }, { status: 400 });
  }

  let solarDate: Date;

  if (body.mode === "solar") {
    const raw = typeof body.solarDate === "string" ? body.solarDate : "";
    const parsed = parseSolarDateString(raw);
    if (!parsed) {
      return NextResponse.json({ error: "國曆日期格式不正確，或該日期不存在" }, { status: 400 });
    }
    solarDate = parsed;
  } else if (body.mode === "lunar") {
    const y = Number(body.lunarYear);
    const m = Number(body.lunarMonth);
    const d = Number(body.lunarDay);
    const leap = Boolean(body.lunarIsLeapMonth);

    if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) {
      return NextResponse.json({ error: "農曆生日請完整輸入年、月、日" }, { status: 400 });
    }
    const validationError = validateLunarBirthdayInput(y, m, d, leap);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }
    try {
      solarDate = lunarToSolar(y, m, d, leap);
    } catch {
      return NextResponse.json({ error: "這組農曆日期無法換算，請確認輸入是否正確" }, { status: 400 });
    }
  } else {
    return NextResponse.json({ error: "mode 必須是 solar 或 lunar" }, { status: 400 });
  }

  const lunar = solarToLunar(solarDate);

  return NextResponse.json({
    solarDate: toIsoDateString(solarDate),
    solarFormatted: formatSolarDate(solarDate),
    lunar,
    lunarFormatted: formatLunarDate(lunar),
    zodiac: getZodiacByLunarYear(lunar.year),
    actualAge: getActualAge(solarDate),
    nominalAge: getNominalAge(lunar.year),
  });
}
